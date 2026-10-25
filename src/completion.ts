// Shows a checked suggestion as gray ghost text, using VS Code's inline completion API.
// The user accepts it with Tab; typing anything else makes it disappear.
//
// How VS Code's API works: we don't draw anything ourselves. We register a "provider",
// and VS Code asks it "anything to show at this spot?" whenever it wants to. So:
//   1. show() stores the suggestion and pokes VS Code (inlineSuggest.trigger).
//   2. VS Code calls provideInlineCompletionItems(), and we hand the suggestion over.
//
// VS Code only shows ghost text that INSERTS at the cursor. It may start a bit earlier on
// the same line, as long as it begins with what's already typed there (VS Code then shows
// just the rest). Anything else, like rewriting other lines, is silently ignored by VS Code,
// so show() checks for it and says why instead.

import * as vscode from "vscode";
import type { Reply } from "./types";

// The suggestion waiting to be shown, already converted to VS Code's 0-based positions.
interface Pending {
  uri: string; // which document it belongs to
  docVersion: number; // the document version it was made for
  cursor: vscode.Position; // where the cursor was; ghost text only shows there
  range: vscode.Range; // from the suggestion's start up to the cursor
  text: string;
}

export class Completion implements vscode.InlineCompletionItemProvider, vscode.Disposable {
  private pending: Pending | undefined;
  private readonly registration: vscode.Disposable;

  constructor() {
    // Offer ghost text in every real file (not output panels, not untitled buffers).
    this.registration = vscode.languages.registerInlineCompletionItemProvider(
      { scheme: "file" },
      this,
    );
  }

  // Store a suggestion that reply.ts already approved, and ask VS Code to show it.
  // Returns undefined if it will show, or the reason it can't be shown as ghost text.
  show(editor: vscode.TextEditor, reply: Reply): string | undefined {
    const doc = editor.document;
    const cursor = editor.selection.active;
    // The reply is 1-based; VS Code is 0-based.
    const start = new vscode.Position(reply.start.line - 1, reply.start.col - 1);
    const end = new vscode.Position(reply.end.line - 1, reply.end.col - 1);

    // It must start on the cursor's line, at or before the cursor.
    if (start.line !== cursor.line || start.isAfter(cursor)) {
      return "suggestion doesn't start at the cursor's line";
    }
    // Text between its start and the cursor must already match its beginning.
    // E.g. the line has "  return " and the agent sent "return a * b;": fine.
    const typed = doc.getText(new vscode.Range(start, cursor));
    if (!reply.text.startsWith(typed)) return "suggestion rewrites text before the cursor";
    // Anything it replaces after the cursor must be blank (spaces, empty lines).
    if (end.isAfter(cursor) && doc.getText(new vscode.Range(cursor, end)).trim() !== "") {
      return "suggestion rewrites text after the cursor";
    }

    this.pending = {
      uri: doc.uri.toString(),
      docVersion: reply.docVersion,
      cursor,
      range: new vscode.Range(start, cursor),
      text: reply.text,
    };
    void vscode.commands.executeCommand("editor.action.inlineSuggest.trigger");
    return undefined;
  }

  // VS Code calls this when it wants ghost text (after our trigger, and on its own while typing).
  // We answer only for the exact document, version and cursor spot the suggestion was made for.
  // Once the user types, moves or accepts, that no longer matches, so it's never shown again.
  provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.InlineCompletionItem[] {
    const p = this.pending;
    if (!p || p.uri !== document.uri.toString() || p.docVersion !== document.version) return [];
    if (!position.isEqual(p.cursor)) return [];
    return [new vscode.InlineCompletionItem(p.text, p.range)];
  }

  dispose(): void {
    this.registration.dispose();
  }
}
