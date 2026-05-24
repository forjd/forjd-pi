# forjd-pi

A small [pi coding agent](https://pi.dev) extension pack from Forjd.

The first extension is a high-level Git diff sidebar: a passive right-side panel that keeps the current working tree visible while you code with pi.

## Features

- Right-side Git diff overview for interactive pi sessions
- Current repository, branch, and no-commits state
- Counts for staged, changed, untracked, conflicted, and binary files
- Aggregate additions and deletions
- Largest changed files sorted to the top
- Non-capturing overlay, so the editor keeps focus
- Automatically hides on narrow terminals and leaves a compact footer status

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

You can also test the extension for one pi run without installing it:

```bash
pi -e ./extensions/git-diff-sidebar.ts
```

## Usage

The sidebar starts automatically in interactive pi sessions when this package is installed.

Commands:

```text
/git-diff-sidebar          Toggle the sidebar
/git-diff-sidebar on       Enable it
/git-diff-sidebar off      Disable it
/git-diff-sidebar refresh  Refresh Git status now
```

The overlay is passive. It does not capture keyboard input, and it is hidden when the terminal is narrower than 100 columns.

## Package contents

```text
extensions/git-diff-sidebar.ts  Git diff sidebar extension
```

The pi manifest is declared in `package.json`:

```json
{
  "pi": {
    "extensions": ["./extensions"]
  }
}
```

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
