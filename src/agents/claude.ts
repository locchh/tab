// Claude Code adapter. Talks to `claude -p` in stream-json mode:
// we write one JSON message per line to its stdin, it writes one JSON event per line to stdout.
// See "Long-lived agent session" in docs/SKETCH.md for the flags and events.

import type { ChildProcess } from "node:child_process";
import { type Agent, type AgentError, errorKindFromText } from "./agent";
import { readLines, spawnAgent, stopProcess, writeLine } from "./process";

const TRIGGER = "go, make a suggestion now";

export class ClaudeAgent implements Agent {
  private child: ChildProcess | undefined;
  private replyCb: (text: string) => void = () => {};
  private errorCb: (err: AgentError) => void = () => {};

  // Set while an interrupt is in flight: results that arrive meanwhile are stale, so we drop them.
  private interrupting = false;
  // Interrupts waiting for their confirmation, by request id.
  private pendingInterrupts = new Map<string, () => void>();
  private nextRequestId = 1;
  // True after stop(), so an exit we asked for isn't reported as a crash.
  private stopping = false;

  constructor(private readonly cwd: string) {}

  start(instructions: string): Promise<void> {
    const child = spawnAgent(
      "claude",
      [
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        // Read-only: only these tools, and no MCP servers (they can change things outside the machine).
        "--tools",
        "Read,Grep,Glob",
        "--strict-mcp-config",
        "--append-system-prompt",
        instructions,
      ],
      this.cwd,
    );
    this.child = child;

    if (child.stdout) readLines(child.stdout, (line) => this.onLine(line));
    child.on("exit", (code) => {
      if (!this.stopping) this.errorCb({ kind: "crashed", message: `claude exited (${code})` });
    });

    // "spawn" = the process started. "error" with ENOENT = the `claude` command doesn't exist.
    return new Promise((resolve, reject) => {
      child.once("spawn", () => resolve());
      child.once("error", (e: NodeJS.ErrnoException) => {
        const kind = e.code === "ENOENT" ? "not-installed" : "other";
        reject({ kind, message: e.message } satisfies AgentError);
      });
    });
  }

  trigger(): void {
    if (!this.child) return;
    writeLine(this.child, { type: "user", message: { role: "user", content: TRIGGER } });
  }

  interrupt(): Promise<void> {
    const child = this.child;
    if (!child) return Promise.resolve();
    const requestId = `interrupt-${this.nextRequestId++}`;
    this.interrupting = true;
    writeLine(child, {
      type: "control_request",
      request_id: requestId,
      request: { subtype: "interrupt" },
    });
    // Resolves when Claude confirms with a control_response (see onLine).
    return new Promise((resolve) => this.pendingInterrupts.set(requestId, resolve));
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

  // One JSON event from Claude. We only care about two kinds; the rest (init, assistant
  // messages, hooks, rate-limit info…) are progress updates we can ignore.
  private onLine(line: string): void {
    let event: { type?: string; subtype?: string; is_error?: boolean; result?: string };
    let response: { request_id?: string } | undefined;
    try {
      const parsed = JSON.parse(line);
      event = parsed;
      response = parsed.response;
    } catch {
      return; // not JSON: ignore
    }

    // Confirmation that an interrupt went through.
    if (event.type === "control_response" && response?.request_id) {
      this.pendingInterrupts.get(response.request_id)?.();
      this.pendingInterrupts.delete(response.request_id);
      this.interrupting = this.pendingInterrupts.size > 0;
      return;
    }

    // The end of a turn.
    if (event.type === "result") {
      // An interrupted turn ends like this. It's not a reply and not an error.
      if (event.subtype === "error_during_execution" || this.interrupting) return;
      const text = event.result ?? "";
      if (event.is_error || event.subtype !== "success") {
        this.errorCb({ kind: errorKindFromText(text), message: text });
      } else {
        this.replyCb(text);
      }
    }
  }
}
