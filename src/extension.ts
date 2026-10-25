// The switchboard: creates every piece and connects them. See docs/HOW_IT_WORKS.md.
// The VS Code API. Not bundled: VS Code provides it at runtime (see --external vscode in package.json).
import * as vscode from "vscode";
import { ClaudeAgent } from "./agents/claude";
import { CodexAgent } from "./agents/codex";
import { Completion } from "./completion";
// The bundled prompt, inlined into dist/extension.js as a string at build time.
import instructions from "./instructions.md" with { type: "text" };
import { isFresh, parseReply } from "./reply";
import { Session } from "./session";
import { Status } from "./status";
import { Tracker } from "./tracker";
import { Triggers } from "./triggers";
import type { Effort } from "./types";

// Reads Tab's settings fresh each time (they can change while VS Code runs).
const settings = () => vscode.workspace.getConfiguration("tab");

// VS Code calls this once, when the activation event fires ("onStartupFinished" in package.json).
export async function activate(context: vscode.ExtensionContext) {
  // Status bar, settings popup and log. Everything in subscriptions is cleaned up on shutdown.
  const status = new Status();
  context.subscriptions.push(
    status,
    // Clicking the status bar item runs this command.
    vscode.commands.registerCommand("tab.menu", () => status.openMenu()),
  );

  // The workspace root is the first workspace folder. No folder open = nothing to track.
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) {
    status.setSessionStatus("error", "Open a folder to use Tab");
    return;
  }

  // Start tracking the editor and writing the State.
  const tracker = new Tracker(root, settings().get<number>("syncInterval", 300));
  tracker.effort = settings().get<Effort>("effort", "low");
  status.setEffort(tracker.effort);
  status.setPaused(!settings().get<boolean>("enabled", true));
  context.subscriptions.push(tracker);
  await tracker.start();

  // Shows approved suggestions as ghost text.
  const completion = new Completion();
  context.subscriptions.push(completion);

  // Check every reply before using it: right shape, and still for what the user has open.
  const showReply = (text: string) => {
    const reply = parseReply(text);
    if (!reply) return status.log(`bad reply dropped: ${text}`);

    const doc = vscode.window.activeTextEditor?.document;
    const current = doc
      ? { file: vscode.workspace.asRelativePath(doc.uri, false), docVersion: doc.version }
      : null;
    if (!isFresh(reply, current)) return status.log("stale reply dropped");

    status.log(`suggestion: ${JSON.stringify(reply)}`);
    if (doc) completion.show(doc, reply);
  };

  // Builds a session for the agent chosen in settings. Session never knows which CLI it runs:
  // it only gets createAgent. Rebuilt when the "agent" setting changes.
  const makeSession = () => {
    const agentName = settings().get<string>("agent", "claude");
    const s = new Session({
      createAgent: () =>
        agentName === "codex" ? new CodexAgent(root.fsPath) : new ClaudeAgent(root.fsPath),
      instructions,
      getEffort: () => tracker.effort,
      log: (m) => status.log(m),
    });
    s.onStatusChange((state, detail) => status.setSessionStatus(state, detail));
    // The agent has now seen the changed files, so the tracker starts a fresh list.
    s.onTurnCompleted(() => tracker.turnCompleted());
    s.onSuggestion(showReply);
    // Not awaited: starting can take a few seconds, and VS Code shouldn't wait for it.
    void s.start();
    return s;
  };

  // Builds the triggers with the delay from settings. Rebuilt when the delay changes.
  // When a trigger fires: write a fresh State first, so the agent never reads stale data.
  const makeTriggers = () => {
    const t = new Triggers(settings().get<number>("autoSuggestDelay", 2000), async () => {
      if (!settings().get<boolean>("enabled", true)) return; // paused
      await tracker.writeNow();
      status.log("trigger");
      await session.request();
    });
    t.start();
    return t;
  };

  let session = makeSession();
  let triggers = makeTriggers();
  // session and triggers can be replaced, so clean up whichever ones are current.
  context.subscriptions.push({
    dispose: () => {
      session.dispose();
      triggers.dispose();
    },
  });

  // Typing during a turn makes its answer stale: cancel it.
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document === vscode.window.activeTextEditor?.document) void session.cancel();
    }),
  );

  // React to settings changes (from the popup or the Settings page).
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("tab.effort")) {
        tracker.effort = settings().get<Effort>("effort", "low");
        status.setEffort(tracker.effort);
      }
      if (e.affectsConfiguration("tab.enabled")) {
        const enabled = settings().get<boolean>("enabled", true);
        status.setPaused(!enabled);
        if (!enabled) void session.cancel();
      }
      if (e.affectsConfiguration("tab.agent")) {
        // A different CLI: stop the old agent and start a new session.
        session.dispose();
        session = makeSession();
      }
      if (e.affectsConfiguration("tab.autoSuggestDelay")) {
        triggers.dispose();
        triggers = makeTriggers();
      }
      if (e.affectsConfiguration("tab.syncInterval")) {
        tracker.setSyncInterval(settings().get<number>("syncInterval", 300));
      }
    }),
  );
}

// VS Code calls this on shutdown. Nothing to do here: everything in context.subscriptions
// is cleaned up automatically.
export function deactivate() {}
