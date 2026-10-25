// The switchboard: creates every piece and connects them. See docs/HOW_IT_WORKS.md.
// The VS Code API. Not bundled: VS Code provides it at runtime (see --external vscode in package.json).
import * as vscode from "vscode";
import { ClaudeAgent } from "./agents/claude";
import { CodexAgent } from "./agents/codex";
import { Completion } from "./completion";
import { Inbox } from "./inbox";
// The bundled prompt, inlined into dist/extension.js as a string at build time.
import instructions from "./instructions.md" with { type: "text" };
import { isFresh, parseReply } from "./reply";
import { Session } from "./session";
import { Status } from "./status";
import { Tracker } from "./tracker";
import { Triggers } from "./triggers";
import type { Effort, Mode } from "./types";

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
  const tracker = new Tracker(root, settings().get<number>("syncInterval", 300), (m) =>
    status.log(m),
  );
  tracker.effort = settings().get<Effort>("effort", "low");
  status.setEffort(tracker.effort);
  context.subscriptions.push(tracker);
  await tracker.start();

  // Shows approved suggestions as ghost text.
  const completion = new Completion();
  context.subscriptions.push(completion);

  // Check every reply before using it: right shape, and still for what the user has open.
  // Every outcome is logged and flashed in the status bar, so nothing fails silently.
  // `label` names where it came from in the log: "#5" (Tab's agent, turn 5) or "#ext".
  const showReply = (text: string, label: string) => {
    const outcome = (logLine: string, flash: string) => {
      status.log(`${label} ${logLine}`);
      status.flash(flash);
    };
    const reply = parseReply(text);
    if (!reply) return outcome(`bad reply dropped: ${text}`, "bad reply (see log)");

    const editor = vscode.window.activeTextEditor;
    const doc = editor?.document;
    const current = doc
      ? { file: vscode.workspace.asRelativePath(doc.uri, false), docVersion: doc.version }
      : null;
    if (!isFresh(reply, current)) return outcome("stale reply dropped", "dropped (you moved on)");
    if (!reply.text) return outcome("no suggestion (agent sent empty text)", "no suggestion");

    status.log(`${label} suggestion: ${JSON.stringify(reply)}`);
    if (!editor) return;
    const notShown = completion.show(editor, reply);
    if (notShown) return outcome(`can't show as ghost text: ${notShown}`, "couldn't display");
    status.log(`${label} shown`);
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
    s.onNotice((message) => status.flash(message));
    // The agent has now seen the changed files, so the tracker starts a fresh list.
    s.onTurnCompleted(() => tracker.turnCompleted());
    s.onSuggestion((text, turn) => showReply(text, `#${turn}`));
    // Not awaited: starting can take a few seconds, and VS Code shouldn't wait for it.
    void s.start();
    return s;
  };

  // Builds the triggers with the delay from settings. Rebuilt when the delay changes.
  // They exist in every mode (so the keybinding always works), but only Internal asks an agent.
  const makeTriggers = () => {
    const t = new Triggers(settings().get<number>("autoSuggestDelay", 2000), async (source) => {
      const mode = settings().get<Mode>("mode", "internal");
      if (mode !== "internal") {
        // Typing pauses do nothing outside Internal. The keybinding still says something.
        if (source !== "keybinding") return;
        if (mode === "paused") return status.flash("paused");
        // External: write the State now, so whoever suggests next sees the newest one.
        await tracker.writeNow();
        status.log("#ext state written (keybinding)");
        return status.flash("state written");
      }
      // Any error here would otherwise vanish (nobody awaits this callback), so log it.
      // Write a fresh State first, so the agent never reads stale data.
      try {
        await tracker.writeNow();
        await session?.request(source);
      } catch (e) {
        status.log(`trigger failed (${source}): ${e}`);
        status.flash("trigger failed (see log)");
      }
    });
    t.start();
    return t;
  };

  // What runs depends on the mode (see docs/plans/001-cr-modes.md):
  //   Paused:   no agent, no inbox
  //   Internal: Tab's agent (session), no inbox
  //   External: no agent, inbox watches .tab/suggestion.json
  // The tracker and triggers run in every mode.
  let session: Session | undefined;
  let inbox: Inbox | undefined;
  let triggers = makeTriggers();

  const applyMode = () => {
    const mode = settings().get<Mode>("mode", "internal");
    status.setMode(mode);
    status.log(`mode: ${mode}`);

    if (mode === "internal" && !session) session = makeSession();
    if (mode !== "internal" && session) {
      // Stop the agent process: it would only spend quota.
      session.dispose();
      session = undefined;
      status.log("agent stopped");
    }

    if (mode === "external" && !inbox) {
      inbox = new Inbox(
        root,
        (text) => showReply(text, "#ext"),
        (m) => status.log(m),
      );
    }
    if (mode !== "external" && inbox) {
      inbox.dispose();
      inbox = undefined;
    }
  };
  applyMode();

  // session, inbox and triggers can be replaced, so clean up whichever ones are current.
  context.subscriptions.push({
    dispose: () => {
      session?.dispose();
      inbox?.dispose();
      triggers.dispose();
    },
  });

  // Typing during a turn makes its answer stale: cancel it.
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document === vscode.window.activeTextEditor?.document) void session?.cancel();
    }),
  );

  // React to settings changes (from the popup or the Settings page).
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("tab.effort")) {
        tracker.effort = settings().get<Effort>("effort", "low");
        status.setEffort(tracker.effort);
      }
      if (e.affectsConfiguration("tab.mode")) applyMode();
      if (e.affectsConfiguration("tab.agent") && session) {
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
