# Implementation Plan

Target: the MVP described in [SKETCH.md](SKETCH.md).

More phases will be added later, based on the backlog and changelog.

## Phase 1 · Design

- [x] SKETCH: features, effort levels, triggers, State, Reply, session, errors
- [x] DATA: inventory, dataflow, trigger message
- [x] DESIGN: structure, components, agent contract
- [x] TECHSTACK
- [x] Bundled instructions (the prompt the agent gets at launch): `src/instructions.md`

## Phase 2 · Setup

- [ ] `package.json`, `tsconfig`, Bun build, `.vsix` packaging
- [ ] Empty extension that activates and shows "Tab" in the status bar
- [ ] Test setup: `bun test` and a headless VS Code run

## Phase 3 · Build MVP

- [ ] `state.ts`: collect the State, write `.tab/state.json`
- [ ] `triggers.ts`: typing pause + keybinding
- [ ] `agents/agent.ts`: the contract
- [ ] `agents/claude.ts`: Claude Code adapter
- [ ] `agents/codex.ts`: Codex adapter
- [ ] `session.ts`: lifecycle, interrupt, deadlines
- [ ] `reply.ts`: shape + `docVersion` check
- [ ] `completion.ts`: show ghost text
- [ ] `status.ts`: status bar, effort picker, log
- [ ] Error handling from the Errors table
- [ ] README install steps