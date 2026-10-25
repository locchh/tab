# ✨ Tab

👻 **Ghost-text suggestions in VS Code, powered by the coding agent you already use.**

Tab runs Claude Code or Codex in the background. When you pause, the agent reads your
project and suggests what comes next, right at the cursor. Press **Tab** to accept.

- **Code and prose:** functions, tests, docs, READMEs
- **Effort levels:** finish the line, the block, or the whole file, or let the agent decide (Auto)
- **Looks around first:** the agent reads related files, not just the one you're in
- **Read-only:** the agent never edits your files
- **Your own agent:** uses your installed CLI and login, no extra account

## Requirements

- VS Code 1.90+ on Linux
- [Claude Code](https://code.claude.com) or [Codex](https://github.com/openai/codex), installed and logged in
- [Bun](https://bun.sh) to build

## Install

Tab isn't on the Marketplace yet. Build it and install the `.vsix`:

```bash
git clone https://github.com/locchh/tab && cd tab
bun install
bun run package
code --install-extension tab-0.0.3.vsix
```

Reload VS Code and look for **✨ Tab: Low** in the status bar.

## Use

| To | Do |
|---|---|
| Get a suggestion | Stop typing for 2 s, or press `Ctrl+Alt+Space` |
| Accept it | `Tab` |
| Dismiss it | Keep typing |
| Change effort, agent or timing | Click **Tab** in the status bar |
| See what's happening | View → Output → **Tab** |
| Switch mode (Paused / Internal / External) | Click **Tab** in the status bar → Mode |

| Effort | What it writes |
|---|---|
| Low | The rest of the line or sentence |
| Medium | The rest of the function, paragraph or section |
| High | The whole file or document |
| Auto | Whatever the spot needs: the agent decides |

## External mode

Let another agent suggest instead of Tab's own: switch the mode to **External**, copy
[`assets/SKILL.md`](assets/SKILL.md) into your project, and run your agent in a loop. Each run
reads `.tab/state.json` and writes one suggestion to `.tab/suggestion.json`; Tab shows it and
deletes it.

```bash
# Claude Code (built-in loop, 1 minute minimum)
/loop 1m follow SKILL.md

# Codex (no built-in loop)
while true; do codex exec "follow SKILL.md"; sleep 3; done
```

To stop: `Ctrl+C` the Codex loop, or ask Claude to cancel its loop. Each run uses your agent's
quota, even when nothing changed.

## Good to know

- Tab writes what you're doing to `.tab/state.json` in your project (ignored by git
  automatically). The agent reads it from there.
- The agent may read any file in your workspace, the same as when you run it yourself.
- Each suggestion uses your agent's quota.

## More

- [How it works](docs/HOW_IT_WORKS.md) · [Design](docs/SKETCH.md) · [Development](docs/DEVELOPMENT.md)
- [Changelog](CHANGELOG.md) · [Backlog](docs/BACKLOG.md)

MIT License
