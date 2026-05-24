# Contributing

Thanks for helping improve `forjd-pi`.

## Development setup

```bash
npm install
npm run typecheck
```

To test the extension in pi without installing it globally:

```bash
pi -e ./extensions/git-diff-sidebar.ts
```

## Pull requests

- Keep extensions small and focused.
- Prefer passive UI that does not interrupt the main editor unless a command explicitly asks for interaction.
- Run `npm run typecheck` before opening a PR.
- Update the README when adding commands, configuration, or visible UI changes.

## Security

Pi extensions run with the user's system permissions. Avoid hidden network calls, destructive shell commands, or filesystem writes unless they are clearly documented and user initiated.
