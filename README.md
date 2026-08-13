# assetto-diffx

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

- **Split / Unified view** — Toggle between side-by-side and inline diff
- **Syntax highlighting** — Powered by Shiki with GitHub themes
- **File tree** — Hierarchical file browser with search filter and file change-type icons
- **Inline comments** — Click the `+` button on any line to add a review comment
- **Comment replies** — AI agents can reply to comments via API, displayed with bot avatar in the UI
- **Comment status tracker** — Sidebar widget showing open, replied, and resolved comment counts with click-to-navigate links
- **Copy comments** — One-click copy all comments as structured XML for AI coding agents
- **Image preview** — Side-by-side comparison for added, modified, and deleted images
- **Viewed tracking** — Mark files as reviewed to track progress
- **Staged / Untracked toggles** — Choose which changes to include
- **Custom diff commands** — Pass any `git diff` arguments after `--`
- **EditorConfig support** — Respects `.editorconfig` for per-file tab size
- **Persistent settings** — Your preferences are saved across sessions

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
</file>
</code-review-comments>
```

Each comment includes the commented code line with a `+`/`-` prefix indicating whether it's an added or removed line.

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
