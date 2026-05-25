# Contributing

Thanks for helping improve `forjd-pi`.

## Development setup

This repository uses Bun for local development and CI. Pi extensions should remain Node-compatible at runtime, so avoid Bun-only APIs in extension code.

```bash
bun install
bun run typecheck
```

To test the package set in pi without installing it globally:

```bash
pi -e /path/to/forjd-pi
```

To test only the Git diff sidebar extension:

```bash
pi -e ./extensions/git-diff-sidebar.ts
```

## Pull requests

- Keep extensions small and focused.
- Prefer passive UI that does not interrupt the main editor unless a command explicitly asks for interaction.
- Run `bun run typecheck` before opening a PR.
- GitHub Actions runs `bun install --frozen-lockfile`, `bun run typecheck`, and `bun pm pack --dry-run` on pushes and pull requests targeting `main`.
- Update the README when adding commands, configuration, package contents, or visible UI changes.

## Security

Pi extensions run with the user's system permissions. Avoid hidden network calls, destructive shell commands, or filesystem writes unless they are clearly documented and user initiated.
