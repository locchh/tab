# Design

How the code is organized. What Tab does: [SKETCH.md](SKETCH.md). What data moves: [DATA.md](DATA.md).

## Structure

```
.
├── src/
│   ├── extension.ts      entry point: activate / deactivate
│   ├── state.ts          builds the State from VS Code events, writes .tab/state.json
│   ├── triggers.ts       typing-pause timer + keybinding
│   ├── session.ts        keeps the agent alive, sends triggers, handles crash/sleep/restart
│   ├── agents/
│   │   ├── agent.ts      the contract every adapter follows
│   │   ├── claude.ts     Claude Code adapter (JSON lines)
│   │   └── codex.ts      Codex adapter (JSON-RPC)
│   ├── reply.ts          parses and validates the reply, checks docVersion
│   ├── completion.ts     inline completion provider (shows ghost text)
│   └── status.ts         status bar + "Tab" log
└── test/
```

## Core components

| Component | Job | Talks to |
|---|---|---|
| State | Collects editor facts and writes the file | VS Code, `.tab/` |
| Triggers | Decides when to ask | State, Session |
| Session | Keeps the agent alive, sends triggers, interrupts | Agent |
| Agent adapters | Translate to and from each CLI's protocol | Claude Code, Codex |
| Reply | Checks the reply's shape and freshness | Session, Completion |
| Completion | Shows the suggestion as ghost text | VS Code |
| Status | Status bar and log | Everyone |

## Agent contract

Every adapter follows one interface, so the rest of the code never knows which CLI is behind it.

```ts
interface Agent {
  start(instructions: string): Promise<void>
  trigger(): void            // sends "go, make a suggestion now"
  interrupt(): Promise<void>
  stop(): void
  onReply(cb: (text: string) => void): void
  onError(cb: (err: AgentError) => void): void
}
```

- `session.ts` only talks to `Agent`.
- A new agent (Gemini, Aider, …) is one new file in `agents/`. Nothing else changes.
- Protocol details (JSON lines, JSON-RPC) stay inside each adapter.
