# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project overview

`forjd-pi` is a TypeScript extension pack for the pi coding agent. The package currently provides a passive Git diff sidebar extension in `extensions/git-diff-sidebar.ts`.

## Development commands

- Install dependencies: `bun install`
- Type-check the project: `bun run typecheck`
- Test the extension in a local pi session: `pi -e ./extensions/git-diff-sidebar.ts`

Run `bun run typecheck` before considering code changes complete.

## Repository conventions

- Keep extensions small, focused, and easy to audit.
- Prefer passive UI that does not interrupt the main editor unless a command explicitly asks for interaction.
- Keep terminal UI responsive and avoid capturing input unless required by the feature.
- Use Conventional Commits for commit messages.
- Update `README.md` when adding commands, configuration, package contents, or visible UI behavior.
- Update `CONTRIBUTING.md` when changing development workflow or contributor expectations.

## Safety and security

Pi extensions run with the user's system permissions.

- Do not add hidden network calls.
- Do not run destructive shell commands automatically.
- Do not write to the filesystem unless the behavior is documented and user initiated.
- Avoid collecting or displaying sensitive data beyond what the feature clearly requires.

## File map

- `extensions/` — pi extension source files.
- `package.json` — package metadata, scripts, dependencies, and pi manifest.
- `README.md` — user-facing package documentation.
- `CONTRIBUTING.md` — contributor workflow and expectations.
