// Shows a checked suggestion as gray ghost text, using VS Code's inline completion API.
// The user accepts it with Tab; typing anything else makes it disappear.
//
// How VS Code's API works: we don't draw anything ourselves. We register a "provider",
// and VS Code asks it "anything to show at this spot?" whenever it wants to. So:
//   1. show() stores the suggestion and pokes VS Code (inlineSuggest.trigger).
//   2. VS Code calls provideInlineCompletionItems(), and we hand the suggestion over.

import * as vscode from "vscode";
import type { Reply } from "./types";

// The suggestion waiting to be shown, already converted to VS Code's 0-based positions.
interface Pending {
  uri: string; // which document it belongs to
  docVersion: number; // the document version it was made for
  range: vscode.Range;
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
  show(document: vscode.TextDocument, reply: Reply): void {
    if (!reply.text) return; // "" = the agent had nothing good to suggest

    this.pending = {
      uri: document.uri.toString(),
      docVersion: reply.docVersion,
      // The reply is 1-based; VS Code is 0-based.
      range: new vscode.Range(
        reply.start.line - 1,
        reply.start.col - 1,
        reply.end.line - 1,
        reply.end.col - 1,
      ),
      text: reply.text,
    };
    void vscode.commands.executeCommand("editor.action.inlineSuggest.trigger");
  }

  // VS Code calls this when it wants ghost text (after our trigger, and on its own while typing).
  // We answer only if the suggestion is for this exact document and version. Once the user
  // types or accepts, the version changes, so the old suggestion is never shown again.
  provideInlineCompletionItems(document: vscode.TextDocument): vscode.InlineCompletionItem[] {
    const p = this.pending;
    if (!p || p.uri !== document.uri.toString() || p.docVersion !== document.version) return [];
    return [new vscode.InlineCompletionItem(p.text, p.range)];
  }

  dispose(): void {
    this.registration.dispose();
  }
}
