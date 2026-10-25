// Codex adapter. Talks to `codex app-server` over JSON-RPC:
// every request has an id, and the response comes back with the same id.
// Codex also sends notifications (no id), like "turn/completed".
// See "Long-lived agent session" in docs/SKETCH.md for the handshake and flags.

import { type ChildProcess, execFile } from "node:child_process";
import { promisify } from "node:util";
import { type Agent, type AgentError, type AgentErrorKind, errorKindFromText } from "./agent";
import { readLines, spawnAgent, stopProcess, writeLine } from "./process";

const TRIGGER = "go, make a suggestion now";

// A JSON-RPC message from Codex: a response (id + result/error), a notification
// (method + params), or a request from Codex to us (id + method).
interface RpcMessage {
  id?: number;
  method?: string;
  params?: { item?: { type?: string; text?: string }; turn?: Turn };
  result?: unknown;
  error?: { message: string };
}

// The parts of a Codex turn we use.
interface Turn {
  status: string; // "completed" | "interrupted" | "failed" | "inProgress"
  error?: { message: string; codexErrorInfo?: unknown };
}

export class CodexAgent implements Agent {
  private child: ChildProcess | undefined;
  private replyCb: (text: string) => void = () => {};
  private errorCb: (err: AgentError) => void = () => {};

  // Requests waiting for their response, by id.
  private pending = new Map<
    number,
    { resolve: (r: unknown) => void; reject: (e: Error) => void }
  >();
  private nextId = 1;

  private threadId: string | undefined;
  // The turn in progress, if any, and the last message the agent wrote in it.
  private turnId: string | undefined;
  private lastText = "";
  // Waiting for the current turn to end after an interrupt.
  private interruptDone: (() => void) | undefined;
  private stopping = false;

  constructor(private readonly cwd: string) {}

  async start(instructions: string): Promise<void> {
    // Turn off every MCP server: they can change things outside the machine.
    const servers = await listMcpServers();
    const args = [
      "app-server",
      "--disable",
      "apps",
      // Names stay unquoted: quoted names crash app-server (see docs/SKETCH.md).
      ...servers.flatMap((name) => ["-c", `mcp_servers.${name}.enabled=false`]),
    ];
    const child = spawnAgent("codex", args, this.cwd);
    this.child = child;

    if (child.stdout) readLines(child.stdout, (line) => this.onLine(line));
    child.on("exit", (code) => {
      if (!this.stopping) this.errorCb({ kind: "crashed", message: `codex exited (${code})` });
    });

    // Wait for the process to start; ENOENT = the `codex` command doesn't exist.
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", () => resolve());
      child.once("error", (e: NodeJS.ErrnoException) => {
        const kind = e.code === "ENOENT" ? "not-installed" : "other";
        reject({ kind, message: e.message } satisfies AgentError);
      });
    });

    // The handshake: initialize, then tell Codex we're ready, then open a read-only thread.
    await this.request("initialize", { clientInfo: { name: "tab", version: "0.0.3" } });
    writeLine(child, { jsonrpc: "2.0", method: "initialized" });
    const res = (await this.request("thread/start", {
      cwd: this.cwd,
      sandbox: "read-only",
      approvalPolicy: "never",
      developerInstructions: instructions,
    })) as { thread: { id: string } };
    this.threadId = res.thread.id;
  }

  trigger(): void {
    if (!this.threadId) return;
    this.lastText = "";
    this.request("turn/start", {
      threadId: this.threadId,
      input: [{ type: "text", text: TRIGGER }],
    })
      .then((res) => {
        this.turnId = (res as { turn: { id: string } }).turn.id;
      })
      .catch((e: Error) =>
        this.errorCb({ kind: errorKindFromText(e.message), message: e.message }),
      );
  }

  interrupt(): Promise<void> {
    if (!this.threadId || !this.turnId) return Promise.resolve();
    const done = new Promise<void>((resolve) => {
      this.interruptDone = resolve;
    });
    this.request("turn/interrupt", { threadId: this.threadId, turnId: this.turnId }).catch(() => {
      // The turn may have just finished on its own; turn/completed resolves us either way.
    });
    return done;
  }

  stop(): void {
    this.stopping = true;
    if (this.child) stopProcess(this.child);
  }

  onReply(cb: (text: string) => void): void {
    this.replyCb = cb;
  }

  onError(cb: (err: AgentError) => void): void {
    this.errorCb = cb;
  }

  // Sends a JSON-RPC request and returns a promise for its result.
  private request(method: string, params: unknown): Promise<unknown> {
    const child = this.child;
    if (!child) return Promise.reject(new Error("codex is not running"));
    const id = this.nextId++;
    writeLine(child, { jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  private onLine(line: string): void {
    let msg: RpcMessage;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // not JSON: ignore
    }

    // A response to one of our requests.
    if (msg.id !== undefined && msg.method === undefined) {
      const waiting = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) waiting?.reject(new Error(msg.error.message));
      else waiting?.resolve(msg.result);
      return;
    }

    // A request from Codex (approvals, user input…). Tab is read-only: always say no.
    if (msg.id !== undefined && msg.method) {
      if (this.child) {
        writeLine(this.child, {
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32000, message: "Tab is read-only" },
        });
      }
      return;
    }

    // Notifications.
    if (msg.method === "item/completed" && msg.params?.item?.type === "agentMessage") {
      this.lastText = msg.params.item.text ?? ""; // keep the latest; the final one is the reply
    }
    if (msg.method === "turn/completed" && msg.params?.turn) this.onTurnCompleted(msg.params.turn);
  }

  private onTurnCompleted(turn: Turn): void {
    this.turnId = undefined;

    // Interrupted (or anything ending while we wait for an interrupt): not a reply.
    if (this.interruptDone || turn.status === "interrupted") {
      this.interruptDone?.();
      this.interruptDone = undefined;
      return;
    }

    if (turn.status === "completed") {
      this.replyCb(this.lastText);
    } else if (turn.error) {
      this.errorCb({ kind: errorKind(turn.error), message: turn.error.message });
    }
  }
}

// Codex sends a code (codexErrorInfo) with most errors. Map it to our kinds,
// falling back to the message text.
function errorKind(error: NonNullable<Turn["error"]>): AgentErrorKind {
  const info = error.codexErrorInfo;
  if (info === "unauthorized") return "auth";
  if (info === "usageLimitExceeded" || info === "sessionBudgetExceeded") return "quota";
  if (info === "rateLimitExceeded" || info === "serverOverloaded") return "rate-limit";
  if (typeof info === "object" && info && "httpConnectionFailed" in info) return "network";
  return errorKindFromText(error.message);
}

// Names of the user's configured MCP servers, from `codex mcp list --json`.
// If that fails (no servers, old CLI), there's nothing to turn off.
async function listMcpServers(): Promise<string[]> {
  try {
    const { stdout } = await promisify(execFile)("codex", ["mcp", "list", "--json"]);
    return (JSON.parse(stdout) as { name: string }[]).map((s) => s.name);
  } catch {
    return [];
  }
}
