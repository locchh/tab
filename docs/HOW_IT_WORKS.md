# How It Works

How the code in `src/` fits together, from the moment VS Code starts Tab to a reply coming back.
For the why behind it, see [SKETCH.md](SKETCH.md). For the file list, see [DESIGN.md](DESIGN.md).

## Who does what

| File | Job | Imports `vscode`? |
|---|---|---|
| `extension.ts` | The switchboard: creates everything and connects them | Yes |
| `tracker.ts` | Listens to the editor, keeps history, writes `.tab/state.json` | Yes |
| `state.ts` | Pure State logic (1-based positions, visits, `changed`) | No |
| `types.ts` | Shapes of the State | No |
| `triggers.ts` | Decides *when* to ask: typing pause or keybinding | Yes |
| `session.ts` | Keeps one agent alive, runs one turn at a time | No |
| `reply.ts` | Checks the agent's reply: right shape, still fresh | No |
| `completion.ts` | Shows the checked suggestion as ghost text | Yes |
| `inbox.ts` | External mode: reads `.tab/suggestion.json`, deletes it, passes it on | Yes |
| `agents/agent.ts` | The contract every agent follows | No |
| `agents/claude.ts` | Talks to Claude Code (JSON lines) | No |
| `agents/codex.ts` | Talks to Codex (JSON-RPC) | No |
| `agents/process.ts` | Shared plumbing: spawn, read lines, write, stop | No |
| `instructions.md` | The prompt the agent gets at launch (bundled as a string) | — |
| `markdown.d.ts` | Tells TypeScript that `.md` imports are strings | — |

Files without `vscode` can be unit-tested with `bun test`.

## Who creates whom

`extension.ts` creates the main pieces. They never import each other: `extension.ts`
connects them with callbacks.

```mermaid
flowchart TB
    Ext[extension.ts<br/>switchboard]

    Ext -- creates --> Tracker[Tracker]
    Ext -- creates --> Triggers[Triggers]
    Ext -- creates --> Session[Session]
    Ext -- creates --> Completion[Completion]
    Ext -- "creates (External mode)" --> Inbox[Inbox]
    Ext -- uses --> Reply[reply.ts]

    Tracker -- uses --> State[state.ts]
    Tracker -- uses --> Types[types.ts]

    Session -- "createAgent()" --> Agent{{Agent contract<br/>agent.ts}}
    Agent -. implemented by .-> Claude[ClaudeAgent<br/>claude.ts]
    Agent -. implemented by .-> Codex[CodexAgent<br/>codex.ts]
    Claude -- uses --> Proc[process.ts]
    Codex -- uses --> Proc

    Proc -- spawns --> CLI[(claude / codex CLI)]
```

How they're connected:

| From | Event | To |
|---|---|---|
| Triggers | fires | `tracker.writeNow()`, then `session.request()` |
| Editor | typing in the active file | `session.cancel()` |
| Session | turn completed | `tracker.turnCompleted()` (clears `changed`) |
| Session | needs the deadline | reads `tracker.effort` |
| Session | reply | `parseReply` → `isFresh` → `completion.show()` |

## 1. Startup

```mermaid
sequenceDiagram
    participant VSC as VS Code
    participant Ext as extension.ts
    participant Tr as Tracker
    participant Se as Session
    participant Ag as Agent adapter
    participant CLI as claude / codex

    VSC->>Ext: activate() (onStartupFinished)
    Ext->>Ext: status bar, settings, "Tab" log
    Ext->>Tr: new Tracker(root, syncMs) + start()
    Tr->>Tr: create .tab/ and .tab/.gitignore
    Tr->>Tr: listen to editor events, start sync timer
    Ext->>Se: new Session({ createAgent, instructions, … })
    Ext->>Se: start() (not awaited)
    Se->>Ag: createAgent() → new ClaudeAgent / CodexAgent
    Se->>Ag: start(instructions)
    Ag->>CLI: spawnAgent(…) read-only, instructions attached
    Note over CLI: Codex only: initialize → initialized → thread/start
    Ext->>Ext: new Triggers(delayMs, onTrigger) + start()
    Ext->>Ext: listen for typing → session.cancel()
```

## 2. While the user works: keeping the State fresh

The Tracker keeps **history** (visits, changed, lastChange) from events, and reads
**right-now facts** (active file, cursor, diagnostics) only when it writes.

```mermaid
sequenceDiagram
    actor User
    participant VSC as VS Code
    participant Tr as Tracker
    participant S as state.ts
    participant F as .tab/state.json

    User->>VSC: switches tab / types / selects / scrolls
    VSC->>Tr: event
    Tr->>S: startVisit / addAction / addChanged
    S-->>Tr: new visits / changed lists

    loop every sync interval (200/300/500ms)
        Tr->>Tr: build(): history + fresh active file + diagnostics
        alt something changed since last write
            Tr->>F: write state.json (with syncedAt)
        else nothing changed
            Tr->>Tr: skip
        end
    end
```

## 3. A trigger becomes a reply

```mermaid
sequenceDiagram
    actor User
    participant Trg as Triggers
    participant Ext as extension.ts
    participant Tr as Tracker
    participant Se as Session
    participant Ag as Agent adapter
    participant CLI as claude / codex
    participant F as .tab/state.json
    participant Co as Completion
    participant VSC as VS Code

    alt typing pause
        User->>Trg: stops typing for the delay (1/2/5s)
    else keybinding
        User->>Trg: Ctrl+Alt+Space
    end
    Trg->>Ext: onTrigger()
    Ext->>Tr: writeNow()
    Tr->>F: fresh State
    Ext->>Se: request()
    opt a turn is already running
        Se->>Ag: interrupt()
        Ag-->>Se: confirmed
    end
    Se->>Ag: trigger()
    Se->>Se: start deadline (30s, or 120s for High)
    Ag->>CLI: "go, make a suggestion now"
    CLI->>F: reads State
    CLI->>CLI: explores the project (by effort)
    CLI-->>Ag: reply JSON
    Ag-->>Se: onReply(text)
    Se->>Se: stop deadline, reset crash count
    Se->>Ext: onTurnCompleted()
    Ext->>Tr: turnCompleted() (clear changed)
    Se->>Ext: onSuggestion(text)
    Ext->>Ext: parseReply(text)
    alt bad shape
        Ext->>Ext: log "bad reply dropped"
    else wrong file or docVersion changed
        Ext->>Ext: log "stale reply dropped"
    else good
        Ext->>Co: show(doc, reply)
        Co->>VSC: inlineSuggest.trigger
        VSC->>Co: provideInlineCompletionItems()
        Co-->>VSC: suggestion (if same document + docVersion)
        VSC-->>User: gray ghost text
        User->>VSC: Tab to accept, or keep typing to dismiss
    end
```

## 4. When things go wrong

```mermaid
sequenceDiagram
    actor User
    participant Ext as extension.ts
    participant Se as Session
    participant Ag as Agent adapter

    alt user types during a turn
        User->>Ext: edit in the active file
        Ext->>Se: cancel()
        Se->>Ag: interrupt()
        Note over Se: a late reply is dropped (no turn running)
    else deadline passes
        Se->>Se: log "turn too long"
        Se->>Ag: interrupt()
    else interrupt not confirmed in 5s
        Se->>Ag: stop() (stuck)
        Se->>Se: start() a fresh agent
    else agent process crashes
        Ag-->>Se: onError(crashed)
        Se->>Se: wait 1s / 2s / 5s / 10s, then start()
        Note over Se: more than 3 crashes in 1 minute: give up
    end
```

## Session states

```mermaid
stateDiagram-v2
    [*] --> Starting: start()
    Starting --> Idle: agent started
    Starting --> NoAgent: failed (e.g. not installed)
    Idle --> Busy: request()
    Busy --> Idle: reply / cancel / deadline
    Busy --> Busy: request() (interrupt old, start new)
    Busy --> Starting: stuck after interrupt
    Idle --> Restarting: crash
    Busy --> Restarting: crash
    Restarting --> Starting: after backoff
    Restarting --> NoAgent: too many crashes
    Idle --> [*]: dispose()
```

## Inside the agent adapters

Both follow the same contract. Only the messages differ.

```mermaid
sequenceDiagram
    participant Se as Session
    participant C as ClaudeAgent
    participant CC as claude -p (stream-json)
    participant X as CodexAgent
    participant CX as codex app-server (JSON-RPC)

    Note over Se,CC: Claude Code
    Se->>C: trigger()
    C->>CC: {"type":"user", message: "go, make a suggestion now"}
    CC-->>C: … progress events (ignored) …
    CC-->>C: {"type":"result","subtype":"success","result":"…"}
    C-->>Se: onReply(result)
    Se->>C: interrupt()
    C->>CC: {"type":"control_request", request: {subtype: "interrupt"}}
    CC-->>C: {"type":"control_response"}

    Note over Se,CX: Codex
    Se->>X: trigger()
    X->>CX: turn/start (id: n)
    CX-->>X: response (id: n) with turn id
    CX-->>X: item/completed (agentMessage text)
    CX-->>X: turn/completed (status: completed)
    X-->>Se: onReply(last agentMessage)
    Se->>X: interrupt()
    X->>CX: turn/interrupt
    CX-->>X: turn/completed (status: interrupted)
```

## Shutdown

Everything `extension.ts` creates goes into `context.subscriptions`. When VS Code closes,
it calls `dispose()` on each: the Tracker stops listening and writing, Triggers stops its
timer, and Session stops the agent (close stdin; kill the process group if it doesn't exit
within 3 seconds).
