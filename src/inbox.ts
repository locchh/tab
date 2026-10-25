// External mode's inbox: other tools (Claude in chat, a `/loop`, a `codex exec` loop, a script)
// drop a Reply into .tab/suggestion.json. The Inbox notices, reads it, deletes it, and hands
// the text to the same checker Tab's own agent goes through. See docs/plans/001-cr-modes.md.

import * as vscode from "vscode";

export class Inbox implements vscode.Disposable {
  private readonly file: vscode.Uri;
  private readonly watcher: vscode.FileSystemWatcher;
  // Reading takes a moment. If a new file shows up meanwhile, read again right after.
  private reading = false;
  private readAgain = false;

  // onSuggestion: gets the raw text of each dropped file. log: where to report problems.
  constructor(
    root: vscode.Uri,
    private readonly onSuggestion: (text: string) => void,
    private readonly log: (message: string) => void,
  ) {
    const dir = vscode.Uri.joinPath(root, ".tab");
    this.file = vscode.Uri.joinPath(dir, "suggestion.json");
    this.watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(dir, "suggestion.json"),
    );
    this.watcher.onDidCreate(() => void this.take());
    this.watcher.onDidChange(() => void this.take());
    // One may already be waiting from before External mode was switched on.
    void this.take();
  }

  dispose(): void {
    this.watcher.dispose();
  }

  // Read the file, delete it (so the same suggestion is never shown twice), pass it on.
  private async take(): Promise<void> {
    if (this.reading) {
      this.readAgain = true;
      return;
    }
    this.reading = true;
    try {
      const bytes = await vscode.workspace.fs.readFile(this.file);
      await vscode.workspace.fs.delete(this.file);
      this.onSuggestion(new TextDecoder().decode(bytes));
    } catch (e) {
      // No file is normal (e.g. the delete above triggered the watcher). Anything else: log it.
      if (!(e instanceof vscode.FileSystemError && e.code === "FileNotFound")) {
        this.log(`#ext couldn't read suggestion.json: ${e}`);
      }
    } finally {
      this.reading = false;
    }
    if (this.readAgain) {
      this.readAgain = false;
      void this.take();
    }
  }
}
