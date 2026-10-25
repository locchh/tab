// The VS Code API. Not bundled: VS Code provides it at runtime (see --external vscode in package.json).
import * as vscode from "vscode";
import { Tracker } from "./tracker";

// VS Code calls this once, when the activation event fires ("onStartupFinished" in package.json).
export async function activate(context: vscode.ExtensionContext) {
  // A slot on the right side of the status bar. Higher priority = further left.
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  // $(sparkle) is a built-in VS Code icon. "low" is hardcoded until the effort picker exists.
  status.text = "$(sparkle) Tab: low";
  status.tooltip = "Effort: low";
  status.show();

  // Everything in subscriptions is cleaned up automatically when the extension stops.
  context.subscriptions.push(status);

  // The workspace root is the first workspace folder. No folder open = nothing to track.
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) return;

  // How often to write .tab/state.json, from the "tab.syncInterval" setting (package.json).
  const syncMs = vscode.workspace.getConfiguration("tab").get<number>("syncInterval", 300);

  // Start tracking the editor and writing the State.
  const tracker = new Tracker(root, syncMs);
  context.subscriptions.push(tracker);
  await tracker.start();
}

// VS Code calls this on shutdown. Empty for now; later it stops the agent.
export function deactivate() {}
