// Keeps one agent alive and runs turns on it: trigger → agent → reply.
// Handles the core lifecycle: one turn at a time, deadlines, and restarting after a crash.
// Sleep/resume, "context full" and retry rules come later (see Errors in docs/SKETCH.md).
//
// No vscode import: extension.ts passes in everything Session needs, so it can be
// unit-tested with a fake agent.

import type { Agent, AgentError } from "./agents/agent";
import type { Effort } from "./types";

export interface SessionOptions {
  createAgent: () => Agent; // makes a fresh agent (claude or codex)
  instructions: string; // the bundled prompt, given at launch
  getEffort: () => Effort; // current effort, to pick the deadline
  log: (message: string) => void;
  timing?: Partial<Timing>; // only tests change these
}

interface Timing {
  lowMediumDeadlineMs: number;
  highDeadlineMs: number;
  interruptTimeoutMs: number; // if an interrupt isn't confirmed by then, the agent is stuck
  backoffMs: number[]; // waits before relaunching after the 1st, 2nd, 3rd… crash
}

// From the Deadlines and Errors tables in docs/SKETCH.md.
const DEFAULT_TIMING: Timing = {
  lowMediumDeadlineMs: 30_000,
  highDeadlineMs: 120_000,
  interruptTimeoutMs: 5_000,
  backoffMs: [1_000, 2_000, 5_000, 10_000],
};

// More crashes than this within CRASH_WINDOW_MS: give up and show an error.
const MAX_CRASHES = 3;
const CRASH_WINDOW_MS = 60_000;

export class Session {
  private agent: Agent | undefined;
  private readonly timing: Timing;

  // True while the agent is working on a turn.
  private busy = false;
  // Goes up on every new request or cancel. A request that was waiting for an
  // interrupt checks it: if it changed, a newer request took over, so it gives up.
  private generation = 0;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private crashTimes: number[] = [];
  private stopped = false;

  private suggestionCb: (text: string) => void = () => {};
  private turnCompletedCb: () => void = () => {};

  constructor(private readonly options: SessionOptions) {
    this.timing = { ...DEFAULT_TIMING, ...options.timing };
  }

  // Launch the agent. Errors (e.g. not installed) are logged, not thrown.
  async start(): Promise<void> {
    if (this.stopped) return;
    const agent = this.options.createAgent();
    agent.onReply((text) => this.handleReply(agent, text));
    agent.onError((err) => this.handleError(agent, err));
    this.agent = agent;
    try {
      await agent.start(this.options.instructions);
      this.options.log("agent started");
    } catch (e) {
      const err = e as AgentError;
      this.agent = undefined;
      this.options.log(`agent failed to start (${err.kind}): ${err.message}`);
    }
  }

  // A trigger fired: ask for a suggestion. Interrupts a running turn first.
  async request(): Promise<void> {
    const gen = ++this.generation;
    if (this.busy) await this.interrupt();
    // A newer request or a cancel came in while we waited: let it win.
    if (gen !== this.generation || !this.agent || this.stopped) return;

    this.busy = true;
    this.agent.trigger();
    const ms =
      this.options.getEffort() === "high"
        ? this.timing.highDeadlineMs
        : this.timing.lowMediumDeadlineMs;
    this.deadline = setTimeout(() => this.onDeadline(), ms);
  }

  // The user typed during a turn: the answer would be stale, so stop it quietly.
  async cancel(): Promise<void> {
    this.generation++;
    if (this.busy) await this.interrupt();
  }

  // Called with the reply text of every completed turn.
  onSuggestion(cb: (text: string) => void): void {
    this.suggestionCb = cb;
  }

  // Called when a turn completes, so the tracker can clear `changed`.
  onTurnCompleted(cb: () => void): void {
    this.turnCompletedCb = cb;
  }

  dispose(): void {
    this.stopped = true;
    this.endTurn();
    this.agent?.stop();
    this.agent = undefined;
  }

  // --- Inside ---

  private handleReply(agent: Agent, text: string): void {
    // Ignore replies from an old agent, or when no turn is running (already interrupted).
    if (agent !== this.agent || !this.busy) return;
    this.endTurn();
    this.crashTimes = []; // a successful turn resets the crash count
    this.turnCompletedCb();
    this.suggestionCb(text);
  }

  private handleError(agent: Agent, err: AgentError): void {
    if (agent !== this.agent) return;
    this.endTurn();
    this.options.log(`agent error (${err.kind}): ${err.message}`);
    if (err.kind === "crashed") this.restartAfterCrash();
  }

  // The turn took too long: stop it and report it (an error, not a quiet cancel).
  private onDeadline(): void {
    this.options.log("turn too long: interrupted");
    void this.cancel();
  }

  // Stops the current turn. If the agent doesn't confirm in time, it's stuck: relaunch it.
  private async interrupt(): Promise<void> {
    const agent = this.agent;
    this.endTurn();
    if (!agent) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), this.timing.interruptTimeoutMs);
    });
    const stuck = await Promise.race([agent.interrupt().then(() => false), timedOut]);
    clearTimeout(timer);

    if (stuck && agent === this.agent) {
      this.options.log("agent stuck after interrupt: relaunching");
      agent.stop();
      await this.start();
    }
  }

  // Relaunch after a crash, waiting longer each time. Too many crashes: give up.
  private restartAfterCrash(): void {
    const now = Date.now();
    this.crashTimes = [...this.crashTimes, now].filter((t) => now - t < CRASH_WINDOW_MS);
    if (this.crashTimes.length > MAX_CRASHES) {
      this.options.log("agent crashed too often: stopped");
      this.agent = undefined;
      return;
    }
    const { backoffMs } = this.timing;
    const wait = backoffMs[Math.min(this.crashTimes.length, backoffMs.length) - 1] ?? 0;
    this.options.log(`agent crashed: relaunching in ${wait}ms`);
    setTimeout(() => void this.start(), wait);
  }

  private endTurn(): void {
    this.busy = false;
    clearTimeout(this.deadline);
    this.deadline = undefined;
  }
}
