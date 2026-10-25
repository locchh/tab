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

- [x] `package.json`, `tsconfig`, Bun build, `.vsix` packaging
- [x] Empty extension that activates and shows "Tab" in the status bar
- [x] Test setup: `bun test`
- [x] Lint + format: Biome

## Phase 3 · Build MVP

- [x] `types.ts`: State shape
- [x] `state.ts`: pure State logic (1-based positions, visits, `changed`) + tests
- [x] `tracker.ts`: listen to VS Code, build the State, write `.tab/state.json`
- [x] `triggers.ts`: typing pause + keybinding
- [x] `agents/agent.ts`: the contract
- [x] `agents/process.ts`: shared process plumbing (spawn, read lines, stop) + tests
- [x] `agents/claude.ts`: Claude Code adapter
- [x] `agents/codex.ts`: Codex adapter (successful reply untested: Codex usage limit hit)
- [ ] `session.ts`: lifecycle, interrupt, deadlines
- [ ] `reply.ts`: shape + `docVersion` check
- [ ] `completion.ts`: show ghost text
- [ ] `status.ts`: status bar, effort picker, log
- [ ] Error handling from the Errors table
- [ ] Headless VS Code test
- [ ] README install steps