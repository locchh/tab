# Tech Stack

What Tab is built with and runs on. Versions are the ones in use on 2026-10-24.

## Runtimes

| What                | Version          | Used for                                                      | Official docs                                |
| ------------------- | ---------------- | ------------------------------------------------------------- | -------------------------------------------- |
| Bun                 | 1.3.14           | Dev only: package manager, bundler, test runner               | [bun.sh/docs](https://bun.sh/docs)           |
| Node.js (VS Code's) | VS Code built-in | Runs the extension and spawns the agent (`child_process`)     | [nodejs.org/docs](https://nodejs.org/docs/latest/api/) |
| VS Code             | 1.90 or newer    | Host editor (tested on 1.138)                                 | [Extension API](https://code.visualstudio.com/api) |
| Linux x64           |                  | Only supported platform for the MVP                           |                                              |

## Language and libraries

| What            | Version | Where             | Used for                            | Official docs                                                        |
| --------------- | ------- | ----------------- | ----------------------------------- | -------------------------------------------------------------------- |
| TypeScript      | 5.9.3   | dev               | All code; `bun run typecheck`       | [typescriptlang.org/docs](https://www.typescriptlang.org/docs/)      |
| `@types/vscode` | 1.90.0  | dev               | VS Code extension API types         | [VS Code API reference](https://code.visualstudio.com/api/references/vscode-api) |
| `@types/node`   | 24.10.1 | dev               | Node types for the extension        | [nodejs.org/docs](https://nodejs.org/docs/latest/api/)               |
| `@types/bun`    | 1.3.14  | dev               | Bun types for the tests             | [bun.sh/docs](https://bun.sh/docs)                                   |

No agent SDKs, no schema library, no UI framework.

## Agents

The extension drives the user's installed agent CLI directly, over stdin/stdout.

| Agent       | Tested version | Protocol                                                                       | Official docs                                                    |
| ----------- | -------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Claude Code | 2.1.309        | `claude -p --input-format stream-json --output-format stream-json`: JSON lines | [CLI reference](https://code.claude.com/docs/en/cli-reference)   |
| Codex CLI   | 0.163.0        | `codex app-server`: JSON-RPC over stdio (marked experimental)                  | [openai/codex](https://github.com/openai/codex), [app-server protocol](https://github.com/openai/codex/tree/main/codex-rs/app-server-protocol) |

Details: [SKETCH.md › Long-lived agent session](SKETCH.md#long-lived-agent-session).

## Protocols

| Between               | How                                                            | Official docs                                             |
| --------------------- | -------------------------------------------------------------- | --------------------------------------------------------- |
| Extension → Claude Code | JSON lines over stdio                                        | [CLI reference](https://code.claude.com/docs/en/cli-reference) |
| Extension → Codex       | JSON-RPC over stdio                                          | [JSON-RPC 2.0](https://www.jsonrpc.org/specification)     |
| Extension → Agent (State) | JSON file in `.tab/`: the extension writes, the agent reads | [Workspace FS](https://code.visualstudio.com/api/references/vscode-api#FileSystem) |

## Build and test

| What                   | Tool                                                               | Official docs                                                                      |
| ---------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Extension build        | `bun build --target=node --format=cjs --external vscode`           | [Bun bundler](https://bun.sh/docs/bundler)                                         |
| Unit tests             | `bun test`                                                         | [Bun test runner](https://bun.sh/docs/cli/test)                                    |
| Typecheck              | `tsc` (`bun run typecheck`)                                        | [TypeScript](https://www.typescriptlang.org/docs/)                                 |
| Headless VS Code tests | VS Code's Electron binary under `xvfb-run`, `--extensionTestsPath` | [Testing extensions](https://code.visualstudio.com/api/working-with-extensions/testing-extension) |
| UI checks              | Playwright (installed globally, not a project dependency)          | [Playwright for Electron](https://playwright.dev/docs/api/class-electron)          |

## VS Code API pages Tab relies on

- [Inline completions](https://code.visualstudio.com/api/references/vscode-api#InlineCompletionItemProvider): ghost text
- [Workspace Trust](https://code.visualstudio.com/api/extension-guides/workspace-trust): Tab stays off in untrusted folders
- [Commands](https://code.visualstudio.com/api/extension-guides/command) and [keybindings](https://code.visualstudio.com/api/references/contribution-points#contributes.keybindings): keybinding trigger
- [Status bar](https://code.visualstudio.com/api/ux-guidelines/status-bar): effort level and status (`sleeping`, `waiting`, `offline`, `error`)
- [Configuration](https://code.visualstudio.com/api/references/contribution-points#contributes.configuration): `tab.enabled`, State sync interval, auto-suggest delay
- [Output channel](https://code.visualstudio.com/api/references/vscode-api#OutputChannel): the "Tab" log
- [Workspace FS](https://code.visualstudio.com/api/references/vscode-api#FileSystem): writes the State to `.tab/`
