// The VS Code API. Not bundled: VS Code provides it at runtime (see --external vscode in package.json).
import * as vscode from "vscode";
import { Tracker } from "./tracker";
import { Triggers } from "./triggers";

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

  // Settings from package.json ("contributes.configuration").
  const config = vscode.workspace.getConfiguration("tab");
  const syncMs = config.get<number>("syncInterval", 300);
  const delayMs = config.get<number>("autoSuggestDelay", 2000);

  // The "Tab" log, in the Output panel (View → Output → Tab).
  const log = vscode.window.createOutputChannel("Tab");
  context.subscriptions.push(log);

  // Start tracking the editor and writing the State.
  const tracker = new Tracker(root, syncMs);
  context.subscriptions.push(tracker);
  await tracker.start();

  // When a trigger fires: write a fresh State first, so the agent never reads stale data.
  // The agent isn't built yet, so for now we only log it.
  const triggers = new Triggers(delayMs, async () => {
    await tracker.writeNow();
    log.appendLine(`${new Date().toISOString()} trigger`);
  });
  context.subscriptions.push(triggers);
  triggers.start();
}

// VS Code calls this on shutdown. Empty for now; later it stops the agent.
export function deactivate() {}
