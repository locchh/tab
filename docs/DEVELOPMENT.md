# Development

## Run in dev mode

Opens a separate VS Code window with the latest build. Use this while coding.

```bash
bun run build
code --extensionDevelopmentPath=$PWD
```

## Check

```bash
bun run typecheck
```

## Package

Makes `tab-<version>.vsix`: one file with everything needed to install Tab.

```bash
bun run package
```

## Install from VSIX

Tab isn't on the Marketplace, so it's installed from the `.vsix` file (sideloading).

```bash
code --install-extension tab-0.0.1.vsix
```

Or in VS Code: Extensions → `...` → **Install from VSIX...**

The installed copy doesn't update by itself. After a change, package and install again,
or uninstall it and use dev mode.

## Uninstall

```bash
code --uninstall-extension locchh.tab
```
