// The VS Code API. Not bundled: VS Code provides it at runtime (see --external vscode in package.json).
import * as vscode from "vscode";
import { ClaudeAgent } from "./agents/claude";
import { CodexAgent } from "./agents/codex";
// The bundled prompt, inlined into dist/extension.js as a string at build time.
import instructions from "./instructions.md" with { type: "text" };
import { isFresh, parseReply } from "./reply";
import { Session } from "./session";
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
  const agentName = config.get<string>("agent", "claude");

  // The "Tab" log, in the Output panel (View → Output → Tab).
  const log = vscode.window.createOutputChannel("Tab");
  context.subscriptions.push(log);

  // Start tracking the editor and writing the State.
  const tracker = new Tracker(root, syncMs);
  context.subscriptions.push(tracker);
  await tracker.start();

  // Writes a timestamped line to the log.
  const write = (message: string) => log.appendLine(`${new Date().toISOString()} ${message}`);

  // The agent session. Session never knows which CLI it runs: it only gets createAgent.
  const session = new Session({
    createAgent: () =>
      agentName === "codex" ? new CodexAgent(root.fsPath) : new ClaudeAgent(root.fsPath),
    instructions,
    getEffort: () => tracker.effort,
    log: write,
  });
  context.subscriptions.push(session);
  // The agent has now seen the changed files, so the tracker starts a fresh list.
  session.onTurnCompleted(() => tracker.turnCompleted());
  // Check every reply before using it: right shape, and still for what the user has open.
  session.onSuggestion((text) => {
    const reply = parseReply(text);
    if (!reply) return write(`bad reply dropped: ${text}`);

    const doc = vscode.window.activeTextEditor?.document;
    const current = doc
      ? { file: vscode.workspace.asRelativePath(doc.uri, false), docVersion: doc.version }
      : null;
    if (!isFresh(reply, current)) return write("stale reply dropped");

    // Showing it as ghost text comes next (completion.ts). For now: log it.
    write(`suggestion: ${JSON.stringify(reply)}`);
  });
  // Not awaited: starting can take a few seconds, and VS Code shouldn't wait for it.
  void session.start();

  // When a trigger fires: write a fresh State first, so the agent never reads stale data.
  const triggers = new Triggers(delayMs, async () => {
    await tracker.writeNow();
    write("trigger");
    await session.request();
  });
  context.subscriptions.push(triggers);
  triggers.start();

  // Typing during a turn makes its answer stale: cancel it.
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document === vscode.window.activeTextEditor?.document) void session.cancel();
    }),
  );
}

// VS Code calls this on shutdown. Nothing to do here: everything in context.subscriptions
// (tracker, triggers, session → agent) is cleaned up automatically.
export function deactivate() {}
