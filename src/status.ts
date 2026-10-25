// Tab's face: everything it shows the user outside the editor text.
//   - The status bar item (bottom right): effort + what Tab is doing.
//   - The settings popup: click the status bar item to see and change settings.
//   - The "Tab" log, in the Output panel.

import * as vscode from "vscode";
import type { SessionStatus } from "./session";
import type { Effort } from "./types";

// One row in a popup menu: what it shows, plus the value it stands for.
interface Option<T> extends vscode.QuickPickItem {
  value: T;
}

export class Status implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly output: vscode.OutputChannel;

  private effort: Effort = "low";
  private session: SessionStatus = "starting";
  private detail = ""; // extra info for the tooltip, e.g. an error message
  private paused = false;
  // A short outcome shown for a few seconds, e.g. "no suggestion".
  private flashText = "";
  private flashTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    // A slot on the right side of the status bar. Higher priority = further left.
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    // Clicking it runs the "tab.menu" command (registered in extension.ts) → openMenu().
    this.item.command = "tab.menu";
    this.output = vscode.window.createOutputChannel("Tab");
    this.render();
    this.item.show();
  }

  // Writes a timestamped line to the log (View → Output → Tab).
  log(message: string): void {
    this.output.appendLine(`${new Date().toISOString()} ${message}`);
  }

  setEffort(effort: Effort): void {
    this.effort = effort;
    this.render();
  }

  setSessionStatus(status: SessionStatus, detail = ""): void {
    this.session = status;
    this.detail = detail;
    this.render();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.render();
  }

  // Shows a short outcome in the status bar for 3 seconds, then goes back to normal.
  // So a turn that ends without ghost text never looks like "nothing happened".
  flash(message: string): void {
    this.flashText = message;
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => {
      this.flashText = "";
      this.render();
    }, 3000);
    this.render();
  }

  // The settings popup. Each row shows its current value; picking one opens its options.
  // Changes are saved to VS Code settings; extension.ts reacts to them.
  async openMenu(): Promise<void> {
    const config = vscode.workspace.getConfiguration("tab");
    const delay = config.get<number>("autoSuggestDelay", 2000);
    const sync = config.get<number>("syncInterval", 300);
    const agent = config.get<string>("agent", "claude");

    const rows: Option<string>[] = [
      { label: "$(dashboard) Effort", description: capitalize(this.effort), value: "effort" },
      { label: "$(hubot) Agent", description: AGENT_NAMES[agent] ?? agent, value: "agent" },
      { label: "$(clock) Suggest after", description: `${delay / 1000} s`, value: "delay" },
      { label: "$(sync) Sync interval", description: `${sync} ms`, value: "sync" },
      {
        label: this.paused ? "$(debug-start) Resume Tab" : "$(debug-pause) Pause Tab",
        value: "pause",
      },
      { label: "$(output) Open log", value: "log" },
    ];
    const picked = await vscode.window.showQuickPick(rows, {
      title: "Tab",
      placeHolder: this.summary(),
    });

    switch (picked?.value) {
      case "effort":
        return this.pickAndSave("effort", "Effort", [
          { label: "Low", detail: "Finish the current line or sentence", value: "low" },
          { label: "Medium", detail: "Finish the half-written block", value: "medium" },
          { label: "High", detail: "Write the whole file or document", value: "high" },
        ]);
      case "agent":
        return this.pickAndSave("agent", "Agent", [
          { label: "Claude Code", value: "claude" },
          { label: "Codex", value: "codex" },
        ]);
      case "delay":
        return this.pickAndSave("autoSuggestDelay", "Suggest after you stop typing for", [
          { label: "1 s", value: 1000 },
          { label: "2 s", value: 2000 },
          { label: "5 s", value: 5000 },
        ]);
      case "sync":
        return this.pickAndSave("syncInterval", "Write the State every", [
          { label: "200 ms", value: 200 },
          { label: "300 ms", value: 300 },
          { label: "500 ms", value: 500 },
        ]);
      case "pause":
        await config.update("enabled", this.paused, vscode.ConfigurationTarget.Global);
        return;
      case "log":
        this.output.show();
        return;
    }
  }

  dispose(): void {
    clearTimeout(this.flashTimer);
    this.item.dispose();
    this.output.dispose();
  }

  // Shows a second popup with options, then saves the chosen one to settings.
  private async pickAndSave<T>(key: string, title: string, options: Option<T>[]): Promise<void> {
    const picked = await vscode.window.showQuickPick(options, { title });
    if (!picked) return; // closed with Esc
    await vscode.workspace
      .getConfiguration("tab")
      .update(key, picked.value, vscode.ConfigurationTarget.Global);
  }

  // Updates the status bar text, icon and tooltip from the current state.
  private render(): void {
    const effort = capitalize(this.effort);
    if (this.paused) {
      this.item.text = "$(debug-pause) Tab: paused";
    } else if (this.session === "error") {
      this.item.text = "$(error) Tab: error";
    } else if (this.flashText) {
      this.item.text = `$(info) Tab: ${this.flashText}`;
    } else if (this.session === "starting" || this.session === "thinking") {
      // loading~spin is a built-in spinning icon.
      this.item.text = `$(loading~spin) Tab: ${effort}`;
    } else {
      this.item.text = `$(sparkle) Tab: ${effort}`;
    }
    this.item.tooltip = `${this.summary()}\nClick for settings`;
  }

  // One line describing what Tab is doing, for the tooltip and the popup.
  private summary(): string {
    if (this.paused) return "Tab is paused";
    if (this.session === "error") return this.detail || "Something went wrong (see the log)";
    if (this.session === "starting") return "Starting the agent…";
    if (this.session === "thinking") return "Thinking…";
    return `Ready · effort ${capitalize(this.effort)}`;
  }
}

const AGENT_NAMES: Record<string, string> = { claude: "Claude Code", codex: "Codex" };

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
