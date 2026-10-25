// Unit tests for src/session.ts, using a fake agent instead of a real CLI.
import { describe, expect, test } from "bun:test";
import type { Agent, AgentError } from "../src/agents/agent";
import { Session } from "../src/session";

// A pretend agent: we decide when it replies, errors, or confirms an interrupt.
class FakeAgent implements Agent {
  triggers = 0;
  interrupts = 0;
  stopped = false;
  replyCb: (text: string) => void = () => {};
  errorCb: (err: AgentError) => void = () => {};
  // Set to false to simulate an agent that never confirms interrupts (stuck).
  confirmsInterrupts = true;

  async start() {}
  trigger() {
    this.triggers++;
  }
  interrupt() {
    this.interrupts++;
    return this.confirmsInterrupts ? Promise.resolve() : new Promise<void>(() => {});
  }
  stop() {
    this.stopped = true;
  }
  onReply(cb: (text: string) => void) {
    this.replyCb = cb;
  }
  onError(cb: (err: AgentError) => void) {
    this.errorCb = cb;
  }
}

// Builds a Session with fake agents and short timings, and records what comes out.
function setup() {
  const agents: FakeAgent[] = [];
  const suggestions: string[] = [];
  const logs: string[] = [];
  let turnsCompleted = 0;
  const session = new Session({
    createAgent: () => {
      const a = new FakeAgent();
      agents.push(a);
      return a;
    },
    instructions: "test",
    getEffort: () => "low",
    log: (m) => logs.push(m),
    timing: { lowMediumDeadlineMs: 50, interruptTimeoutMs: 30, backoffMs: [10] },
  });
  session.onSuggestion((t) => suggestions.push(t));
  session.onTurnCompleted(() => turnsCompleted++);
  return { session, agents, suggestions, logs, turns: () => turnsCompleted };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("Session", () => {
  test("a trigger becomes a suggestion", async () => {
    const { session, agents, suggestions, turns } = setup();
    await session.start();
    await session.request();
    // The agent was asked once, then it replies.
    expect(agents[0]?.triggers).toBe(1);
    agents[0]?.replyCb("hello");
    expect(suggestions).toEqual(["hello"]);
    expect(turns()).toBe(1);
  });

  test("a new trigger interrupts the running turn first", async () => {
    const { session, agents } = setup();
    await session.start();
    await session.request();
    await session.request(); // first turn still running
    expect(agents[0]?.interrupts).toBe(1);
    expect(agents[0]?.triggers).toBe(2);
  });

  test("a reply after cancel is dropped", async () => {
    const { session, agents, suggestions } = setup();
    await session.start();
    await session.request();
    await session.cancel(); // the user typed
    agents[0]?.replyCb("too late");
    expect(suggestions).toEqual([]);
  });

  test("a turn past its deadline is interrupted", async () => {
    const { session, agents, logs } = setup();
    await session.start();
    await session.request();
    await wait(80); // deadline is 50ms in this test
    expect(agents[0]?.interrupts).toBe(1);
    expect(logs).toContain("#1 cancelled: took too long");
  });

  test("a stuck agent is replaced", async () => {
    const { session, agents } = setup();
    await session.start();
    const first = agents[0];
    if (first) first.confirmsInterrupts = false;
    await session.request();
    await session.request(); // tries to interrupt; no confirmation within 30ms
    expect(first?.stopped).toBe(true);
    expect(agents.length).toBe(2); // a fresh agent took over
  });

  test("a crash relaunches the agent after a wait", async () => {
    const { session, agents } = setup();
    await session.start();
    agents[0]?.errorCb({ kind: "crashed", message: "exit 1" });
    await wait(30); // backoff is 10ms in this test
    expect(agents.length).toBe(2);
  });
});
