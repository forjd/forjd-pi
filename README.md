# forjd-pi

A [pi coding agent](https://pi.dev) package set from Forjd.

This package bundles the Forjd Git diff sidebar plus three cloned pi packages:

- [`pi-subagents`](https://github.com/nicobailon/pi-subagents) for delegating work to subagents, chains, and parallel runs
- [`@juicesharp/rpiv-todo`](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-todo) for model-managed task tracking with a live overlay
- [`@juicesharp/rpiv-ask-user-question`](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-ask-user-question) for structured clarification prompts

## Features

- Right-side Git diff overview for interactive pi sessions
- Current repository, branch, and no-commits state
- Counts for staged, changed, untracked, conflicted, and binary files
- Aggregate additions and deletions
- Largest changed files sorted to the top
- Non-capturing overlay, so the editor keeps focus
- Automatically hides on narrow terminals and leaves a compact footer status
- Subagent delegation tools, slash commands, bundled agents, skills, and prompts
- Persistent todo tool and overlay for multi-step work
- Structured `ask_user_question` tool for option-based clarification

## Preview

```text
╭────────────────────────────────────╮
│ Git diff                           │
├────────────────────────────────────┤
│ forjd-pi on main (no commits)      │
│ 7 new                              │
│ +2857 -0  7 files • just now       │
├────────────────────────────────────┤
│ ? package-lock.json       +2016 -0 │
│ ? extensions/git-diff...   +732 -0 │
│ ? README.md                 +51 -0 │
│ ? package.json              +34 -0 │
╰────────────────────────────────────╯
```

## Installation

Install directly from GitHub:

```bash
pi install git:github.com/forjd/forjd-pi
```

Or install from a local checkout while developing:

```bash
pi install /path/to/forjd-pi
```

You can also test the whole package set for one pi run without installing it:

```bash
pi -e /path/to/forjd-pi
```

## Usage

The Git diff sidebar starts automatically in interactive pi sessions when this package is installed.

Commands:

```text
/git-diff-sidebar          Toggle the sidebar
/git-diff-sidebar on       Enable it
/git-diff-sidebar off      Disable it
/git-diff-sidebar refresh  Refresh Git status now
```

The overlay is passive. It does not capture keyboard input, and it is hidden when the terminal is narrower than 100 columns.

The cloned packages also register their upstream tools and commands:

- `subagent` tool, `/subagent`, `/chain`, `/parallel`, and bundled subagent prompts/skills from `pi-subagents`
- `todo` tool and `/todos` command from `rpiv-todo`
- `ask_user_question` tool from `rpiv-ask-user-question`

See the upstream READMEs under `packages/` for detailed usage.

## Package contents

```text
extensions/git-diff-sidebar.ts                Git diff sidebar extension
packages/pi-subagents/                        Cloned pi-subagents package
packages/rpiv-todo/                           Cloned rpiv-todo package
packages/rpiv-ask-user-question/              Cloned rpiv-ask-user-question package
packages/UPSTREAM.md                           Upstream source commits for cloned packages
```

The pi manifest is declared in `package.json` and loads extension, skill, and prompt resources from those paths.

## Development

```bash
npm install
npm run typecheck
npm pack --dry-run
```

## Roadmap

- Configurable sort/grouping rules
- Optional lockfile grouping
- Additional Forjd workflow widgets

## License

MIT © Forjd
