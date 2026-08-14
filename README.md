# assetto-diffx

[![CI](https://github.com/matteodelseppia/assetto-diffx/actions/workflows/ci.yml/badge.svg?branch=main&event=push)](https://github.com/matteodelseppia/assetto-diffx/actions/workflows/ci.yml)
[![CD](https://github.com/matteodelseppia/assetto-diffx/actions/workflows/cd.yml/badge.svg?branch=main)](https://github.com/matteodelseppia/assetto-diffx/actions/workflows/cd.yml)

A local code review tool designed for the coding agent workflow. Review AI-generated changes in a GitHub PR-like web UI, leave inline comments, then hand them back to your coding agent to fix.

![screenshot](https://raw.githubusercontent.com/matteodelseppia/assetto-diffx/main/screenshot.png)

## Install

```bash
npm install -g assetto-diffx
```

## Usage

Run in any git repository:

```bash
assetto-diffx
```

This starts a local server and opens your browser with a diff review UI.

### Options

```
assetto-diffx [options] [-- <git-diff-args>]

Options:
  -p, --port <port>   Server port (default: 3433)
  --no-open           Don't auto-open browser

Examples:
  assetto-diffx                          # Review working tree changes
  assetto-diffx -p 8080                  # Use custom port
  assetto-diffx -- HEAD~3                # Diff against 3 commits ago
  assetto-diffx -- main..HEAD            # Diff between branches
  assetto-diffx -- --cached -- src/      # Staged changes in src/
```

## Features

- **Commit range picker** — Choose the base and compare commits from the toolbar; the diff reloads in place, no restart or page refresh
- **Split / Unified view** — Toggle between side-by-side and inline diff
- **Syntax highlighting** — Powered by Shiki with GitHub themes
- **File tree** — Hierarchical file browser with search filter and file change-type icons
- **Inline comments** — Click the `+` button on any line to add a review comment
- **Multi-line comments** — Drag across the line numbers, or drag the `+` button, to comment on a whole range of lines
- **Comment replies** — AI agents can reply to comments via API, displayed with bot avatar in the UI
- **Comment status tracker** — Sidebar widget showing open, replied, and resolved comment counts with click-to-navigate links
- **Copy comments** — One-click copy all comments as structured XML for AI coding agents
- **Image preview** — Side-by-side comparison for added, modified, and deleted images
- **Viewed tracking** — Mark files as reviewed to track progress
- **Staged / Untracked toggles** — Choose which changes to include
- **Custom diff commands** — Pass any `git diff` arguments after `--`
- **EditorConfig support** — Respects `.editorconfig` for per-file tab size
- **Persistent settings** — Your preferences are saved across sessions

## Choosing what to review

The toolbar's range picker lists the repository's recent commits. Pick a **base**
commit and a **compare** end — either another commit or the working tree — and
the diff is recomputed without reloading the page. "Reset" returns to what the
CLI was started with (the working tree, or the custom `git diff` arguments).

Review comments are meant for a coding agent that edits the working tree, so a
comment on an added line that no longer exists in the current version of the
file is refused; the UI explains why. A comment covering a range is refused
when any one of its lines is gone. Comments on deleted lines are always
allowed, since deleted code is absent by definition.

## Commenting on a range of lines

To comment on more than one line, press the line number of the first line and
drag down (or up) to the last one, then click the `+` button. Dragging the `+`
button itself does the same thing in one gesture. The comment hangs below the
last line of the range, and the form shows which lines it covers.

## Comment Output Format

When you click "Copy comments", the output is structured XML optimized for AI agents:

```xml
<code-review-comments>
<file path="src/utils/parser.ts">
<comment line="42">
<code>+ const parsedToken = tokenize(input)</code>
Rename `x` to `parsedToken` for clarity.
</comment>
<comment line="15">
<code>- if (input != null) {</code>
This null check removal may cause a bug when `input` is undefined.
</comment>
<comment lines="60-62">
<code>+ const a = 1
+ const b = 2
+ const c = 3</code>
Collapse these three into a single lookup table.
</comment>
</file>
</code-review-comments>
```

Each comment includes the commented code with a `+`/`-` prefix on every line, indicating whether it's added or removed. Comments covering several lines carry a `lines="start-end"` attribute instead of `line`.

## Agent Skills

Install the assetto-diffx skills to use assetto-diffx directly from your AI coding agent:

```bash
npx skills add matteodelseppia/assetto-diffx
```

The review workflow uses two commands:

1. **`/assetto-diffx-start-review`** — Launches the assetto-diffx server and opens the browser. Review your changes and leave inline comments.
2. **`/assetto-diffx-finish-review`** — The agent fetches all comments from the running assetto-diffx server via API, applies the requested changes, and marks each comment as resolved. The browser UI updates in real time as comments are resolved.

## Development

```bash
pnpm install
pnpm run check   # lint, typecheck, build, unit tests, system tests
```

Individual checks:

| Command | What it does |
| --- | --- |
| `pnpm run lint` | Static analysis with [oxlint](https://oxc.rs/docs/guide/usage/linter) |
| `pnpm run typecheck` | `tsc --noEmit` over the sources and the tests |
| `pnpm run test:unit` | Unit tests for the pure modules (`test/unit`) |
| `pnpm run test:system` | End-to-end tests that run the built CLI against a throwaway git repository (`test/system`) |

The system tests exercise the real binary, so run `pnpm run build` first.

Every pull request runs the same checks in GitHub Actions
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

## License

MIT
