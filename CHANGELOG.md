# Changelog

## 0.0.3 · 2026-10-25

- Modes: Paused, Internal, External (replaces Pause)
- External mode: show suggestions other tools write to `.tab/suggestion.json`
- `assets/SKILL.md` for external agents (Claude Code `/loop`, `codex exec` loops)

## 0.0.2 · 2026-10-25

- Auto effort: the agent decides how far to look and how much to write

## 0.0.1 · 2026-10-25 · MVP

- Ghost-text suggestions for code and prose, accepted with Tab
- Three effort levels: Low, Medium, High
- Triggers: typing pause (1/2/5 s) and `Ctrl+Alt+Space`
- Agents: Claude Code and Codex, read-only, one long-lived session
- State written to `.tab/state.json` for the agent to read
- Reply checks: shape and freshness; insert-at-cursor only
- Status bar with a settings popup (effort, agent, timings, pause) and a "Tab" log
- Basic recovery: deadlines, interrupts, stuck agent, crash restart with backoff
