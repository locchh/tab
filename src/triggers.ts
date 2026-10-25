// Decides WHEN to ask the agent for a suggestion. Two triggers, both always on:
//   1. Typing pause: the user stops typing for the auto-suggest delay.
//   2. Keybinding: the user presses the "Tab: Suggest now" key. Fires immediately.
// Both call the same onTrigger function, which the extension passes in.

import * as vscode from "vscode";

export class Triggers implements vscode.Disposable {
  // The running typing-pause timer, if any.
  private timer: ReturnType<typeof setTimeout> | undefined;
  private listeners: vscode.Disposable[] = [];

  // delayMs: the auto-suggest delay (1000/2000/5000). onTrigger: what to do when it fires.
  constructor(
    private readonly delayMs: number,
    private readonly onTrigger: () => void,
  ) {}

  start(): void {
    this.listeners.push(
      // Typing starts (or restarts) the countdown.
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document === vscode.window.activeTextEditor?.document) this.restart();
      }),
      // Moving the cursor during a countdown restarts it, so the suggestion
      // shows up where the user ended up. A cursor move alone doesn't start one.
      vscode.window.onDidChangeTextEditorSelection(() => {
        if (this.timer) this.restart();
      }),
      // Switching files cancels the countdown: the user left that spot.
      vscode.window.onDidChangeActiveTextEditor(() => this.cancel()),
      // The keybinding (see "keybindings" in package.json) runs this command.
      vscode.commands.registerCommand("tab.suggest", () => this.fire()),
    );
  }

  dispose(): void {
    this.cancel();
    for (const l of this.listeners) l.dispose();
  }

  private restart(): void {
    this.cancel();
    this.timer = setTimeout(() => this.fire(), this.delayMs);
  }

  private cancel(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private fire(): void {
    this.cancel();
    this.onTrigger();
  }
}
