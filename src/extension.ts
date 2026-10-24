// The VS Code API. Not bundled: VS Code provides it at runtime (see --external vscode in package.json).
import * as vscode from "vscode";

// VS Code calls this once, when the activation event fires ("onStartupFinished" in package.json).
export function activate(context: vscode.ExtensionContext) {
  // A slot on the right side of the status bar. Higher priority = further left.
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  // $(sparkle) is a built-in VS Code icon. "low" is hardcoded until the effort picker exists.
  status.text = "$(sparkle) Tab: low";
  status.tooltip = "Effort: low";
  status.show();

  // Everything in subscriptions is cleaned up automatically when the extension stops.
  context.subscriptions.push(status);
}

// VS Code calls this on shutdown. Empty for now; later it stops the agent.
export function deactivate() {}
