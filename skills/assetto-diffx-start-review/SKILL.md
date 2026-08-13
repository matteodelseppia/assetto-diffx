---
name: assetto-diffx-start-review
description: "Start a code review session by launching the assetto-diffx server and opening the browser UI. Use when the user invokes /assetto-diffx-start-review."
user_invocable: true
---

# Start assetto-diffx Review

Launch the assetto-diffx server so the user can review their git changes in a browser-based UI and leave inline comments.

## What to do

### 1. Launch assetto-diffx

Run `assetto-diffx` in the background. By default it shows all working tree changes (staged + unstaged + untracked).

```bash
assetto-diffx
```

Common variations — use these when the context calls for it:

```bash
assetto-diffx -- --staged          # Only staged changes
assetto-diffx -- HEAD~3            # Last 3 commits
assetto-diffx -- main..HEAD        # Current branch vs main
assetto-diffx -p 8080             # Custom port (default: random available port)
```

Anything after `--` is passed directly to `git diff`, so any valid git diff arguments work.

**Important:** Run assetto-diffx in the background using the Bash tool with `run_in_background: true`, so the server stays alive while the user reviews.

### 2. Tell the user

After launching, tell the user:

> assetto-diffx is running. Review your changes in the browser and leave inline comments. When you're done, come back here and run `/assetto-diffx-finish-review`.

Keep it brief.
