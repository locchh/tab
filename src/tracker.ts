// The glue between VS Code and the State.
// Listens to editor events, keeps the parts of the State that need history
// (visits, changed, lastChange), and writes everything to .tab/state.json.
// The actual logic lives in state.ts; this file only wires VS Code to it.

import * as vscode from "vscode";
import {
  addAction,
  addChanged,
  MAX_DIAGNOSTICS,
  removeVisits,
  startVisit,
  toOneBased,
} from "./state";
import type { ActiveFile, Diagnostic, Effort, LastChange, State, Visit } from "./types";

// Our own folder. Ignored by the file watcher, or writing state.json would
// count as a change, which writes again, forever.
const TAB_DIR = ".tab";

export class Tracker implements vscode.Disposable {
  // Set from outside (the status bar effort picker, later).
  effort: Effort = "low";

  // The parts of the State that need history.
  private visits: Visit[] = [];
  private changed: string[] = [];
  private lastChange: LastChange | null = null;

  // The last usable editor. Kept when focus moves to a terminal or panel.
  private editor: vscode.TextEditor | undefined;

  // The last JSON written (without syncedAt), so we skip writes when nothing changed.
  private lastWritten = "";
  // Writes run one after another, never two at once.
  private writing: Promise<void> = Promise.resolve();

  private timer: ReturnType<typeof setInterval> | undefined;
  private listeners: vscode.Disposable[] = [];

  // root: the first workspace folder. syncMs: the State sync interval (200/300/500).
  constructor(
    private readonly root: vscode.Uri,
    private readonly syncMs: number,
  ) {}

  // Start listening and writing.
  async start(): Promise<void> {
    await this.setUpFolder();

    // Count the file that's already open as the first visit.
    this.onEditorSwitch(vscode.window.activeTextEditor);

    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(this.root, "**/*"),
    );
    this.listeners.push(
      vscode.window.onDidChangeActiveTextEditor((e) => this.onEditorSwitch(e)),
      vscode.workspace.onDidChangeTextDocument((e) => this.onEdit(e)),
      vscode.window.onDidChangeTextEditorSelection((e) => this.onSelection(e)),
      vscode.window.onDidChangeTextEditorVisibleRanges((e) => this.onScroll(e)),
      watcher,
      watcher.onDidChange((uri) => this.onFileChange(uri)),
      watcher.onDidCreate((uri) => this.onFileChange(uri)),
      watcher.onDidDelete((uri) => this.onFileDelete(uri)),
    );

    this.timer = setInterval(() => this.writeNow(), this.syncMs);
  }

  // Write .tab/state.json right away. Called on every sync interval and before each trigger.
  writeNow(): Promise<void> {
    this.writing = this.writing.then(() => this.write());
    return this.writing;
  }

  // A turn finished: the agent has seen the changed files, so start a fresh list.
  turnCompleted(): void {
    this.changed = [];
  }

  // Stop listening and writing. VS Code calls this through context.subscriptions.
  dispose(): void {
    clearInterval(this.timer);
    for (const l of this.listeners) l.dispose();
  }

  // --- Event handlers ---

  // The user switched tabs. Ignore switches to nothing (e.g. focus went to the terminal).
  private onEditorSwitch(editor: vscode.TextEditor | undefined): void {
    const file = editor && this.relPath(editor.document.uri);
    if (!editor || !file) return;
    this.editor = editor;
    this.visits = startVisit(this.visits, file, Date.now());
  }

  // Text changed in some open document (typing, paste, undo, a refactor…).
  private onEdit(e: vscode.TextDocumentChangeEvent): void {
    const file = this.relPath(e.document.uri);
    const change = e.contentChanges.at(-1); // the last change in this batch
    if (!file || !change) return;

    this.changed = addChanged(this.changed, file);

    // lastChange and the "edit" action are only about the file the user is in.
    if (e.document !== this.editor?.document) return;
    this.lastChange = {
      file,
      docVersion: e.document.version,
      start: toOneBased(change.range.start.line, change.range.start.character),
      end: toOneBased(change.range.end.line, change.range.end.character),
      text: change.text,
    };
    this.visits = addAction(this.visits, "edit");
  }

  // The cursor moved or text got selected.
  private onSelection(e: vscode.TextEditorSelectionChangeEvent): void {
    if (e.textEditor !== this.editor) return;
    const action = e.textEditor.selection.isEmpty ? "cursor" : "select";
    this.visits = addAction(this.visits, action);
  }

  private onScroll(e: vscode.TextEditorVisibleRangesChangeEvent): void {
    if (e.textEditor !== this.editor) return;
    this.visits = addAction(this.visits, "scroll");
  }

  // A file changed or was created on disk (saved, git pull, a build…).
  private onFileChange(uri: vscode.Uri): void {
    const file = this.relPath(uri);
    if (file) this.changed = addChanged(this.changed, file);
  }

  private onFileDelete(uri: vscode.Uri): void {
    const file = this.relPath(uri);
    if (!file) return;
    this.changed = addChanged(this.changed, file);
    this.visits = removeVisits(this.visits, [file]);
  }

  // --- Building and writing the State ---

  // Puts the State together. "Right now" facts (active file, diagnostics) are read fresh.
  private build(): Omit<State, "syncedAt"> {
    return {
      effort: this.effort,
      active: this.activeFile(),
      lastChange: this.lastChange,
      changed: this.changed,
      visits: this.visits,
      diagnostics: this.diagnostics(),
    };
  }

  private activeFile(): ActiveFile | null {
    const editor = this.editor;
    // The tab may have been closed since the user was last in it.
    if (!editor || editor.document.isClosed) return null;

    const doc = editor.document;
    const sel = editor.selection;
    return {
      file: this.relPath(doc.uri) ?? "",
      language: doc.languageId,
      docVersion: doc.version,
      cursor: toOneBased(sel.active.line, sel.active.character),
      selection: sel.isEmpty
        ? null
        : {
            start: toOneBased(sel.start.line, sel.start.character),
            end: toOneBased(sel.end.line, sel.end.character),
          },
      dirty: doc.isDirty,
      // Unsaved text only; when saved, the agent reads the file from disk.
      text: doc.isDirty ? doc.getText() : undefined,
      lineCount: doc.lineCount,
    };
  }

  // Errors in workspace files, at most MAX_DIAGNOSTICS. Warnings are left out.
  private diagnostics(): Diagnostic[] {
    const result: Diagnostic[] = [];
    for (const [uri, list] of vscode.languages.getDiagnostics()) {
      const file = this.relPath(uri);
      if (!file) continue;
      for (const d of list) {
        if (d.severity !== vscode.DiagnosticSeverity.Error) continue;
        result.push({ file, line: d.range.start.line + 1, severity: "error", message: d.message });
      }
    }
    return result.slice(0, MAX_DIAGNOSTICS);
  }

  // Writes state.json, but only if something changed since the last write.
  private async write(): Promise<void> {
    const content = this.build();
    // Compare without syncedAt: the time is always new, so it would always look changed.
    const json = JSON.stringify(content);
    if (json === this.lastWritten) return;

    const state: State = { syncedAt: new Date().toISOString(), ...content };
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(this.root, TAB_DIR, "state.json"),
      new TextEncoder().encode(JSON.stringify(state, null, 2)),
    );
    this.lastWritten = json;
  }

  // Creates .tab/ with a .gitignore inside, so state.json never shows up in the
  // user's `git status`.
  private async setUpFolder(): Promise<void> {
    const dir = vscode.Uri.joinPath(this.root, TAB_DIR);
    await vscode.workspace.fs.createDirectory(dir);
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(dir, ".gitignore"),
      new TextEncoder().encode("*\n"),
    );
  }

  // --- Helpers ---

  // Path relative to the workspace root, or undefined if the file doesn't count:
  // not a real file (untitled, output panel…), outside the workspace, or in .tab/ or .git/.
  private relPath(uri: vscode.Uri): string | undefined {
    if (uri.scheme !== "file") return undefined;
    const rootPath = this.root.fsPath;
    if (!uri.fsPath.startsWith(`${rootPath}/`)) return undefined;

    const rel = uri.fsPath.slice(rootPath.length + 1);
    if (rel.startsWith(`${TAB_DIR}/`) || rel.startsWith(".git/")) return undefined;
    return rel;
  }
}
