# Backlog

Ideas and leftovers for after the MVP. Grouped items become the next phase.

## Robustness

- Sleep after idle, resume on the next trigger
- Fresh session when the agent's context is full
- Retries: rate limit, network, quota (see Errors in SKETCH.md)
- Retry a bad reply once with a format reminder
- `sleeping` and `offline` statuses

## Quality

- Headless VS Code test (everything up to the provider)

## Ideas

- Effort as a limit, not a target: effort sets how far the agent looks and the most it
  may write; the agent writes only what the spot needs (one line left = one line, even on High)
- Auto effort: a 4th option where the agent decides both how far to look and how much to
  write (simple line = quick look, empty file = wide look)
- Comments in suggestions, or an explanation shown on the side
- Trigger on cursor move when the line looks unfinished
- macOS and Windows support
