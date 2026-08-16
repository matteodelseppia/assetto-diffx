---
name: assetto-diffx-start-review
description: "Start a code review session by launching the assetto-diffx server, opening the browser UI, and answering comments live as they are posted. Use when the user invokes /assetto-diffx-start-review."
user_invocable: true
---

# Start assetto-diffx Review

Launch the assetto-diffx server so the user can review their git changes in a browser-based UI and leave inline comments, then stay on the line and answer each comment the moment it is posted.

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

> assetto-diffx is running. Review your changes in the browser and leave inline comments — I'll answer each one as you post it. Tell me when you're done.

Keep it brief.

### 3. Wait for comments

Do **not** ask the user to come back and close the review. Instead, wait on the server's live feed of work. It holds the request open until a thread is waiting on an answer:

```bash
curl -s --max-time 65 "http://localhost:<port>/api/comments/pending?since=<version>&timeout=60000"
```

Use `<port>` from the server's startup output, and `since=0` for the first call. The response is:

```json
{
  "version": 7,
  "comments": [
    {
      "id": "uuid",
      "filePath": "src/utils/parser.ts",
      "side": "additions",
      "lineNumber": 42,
      "lineContent": "const x = tokenize(input)",
      "body": "Rename x to parsedToken for clarity",
      "status": "open",
      "createdAt": 1234567890,
      "replies": [
        { "id": "uuid", "body": "Why not a Map here?", "createdAt": 1234567891, "author": "user" }
      ]
    }
  ]
}
```

`comments` holds **every** thread whose last message came from the user — so a burst of comments posted at once all arrive together, and none is missed. An empty `comments` array just means the wait ran out; poll again.

Pass the `version` you received back as `since` on the next call. That is what makes the next request block until something actually changes, instead of handing you the same unanswered thread over and over.

### 4. Answer each comment, then wait again

Handle **every** comment in the batch before polling again. For each one, read the whole thread — the `body` plus every reply in order — and work out what is being asked now. When the last reply is from the user, that follow-up is the request and the original `body` is context. Then decide: **change request** or **question**?

#### Change requests (e.g., "Rename x to parsedToken", "Extract this into a helper")

Read the file at `filePath`, find the code using `lineContent` as context, apply the change, then reply and resolve:

```bash
curl -s -X POST http://localhost:<port>/api/comments/<id>/replies \
  -H "Content-Type: application/json" \
  -d '{"body": "Done. Renamed x to parsedToken."}'

curl -s -X PUT http://localhost:<port>/api/comments/<id> \
  -H "Content-Type: application/json" \
  -d '{"status": "resolved"}'
```

#### Questions (e.g., "Why not use a Map here?", "Is this thread-safe?")

Just reply with an answer. Do **not** modify code or resolve the comment — leave it open for the user to read and follow up.

```bash
curl -s -X POST http://localhost:<port>/api/comments/<id>/replies \
  -H "Content-Type: application/json" \
  -d '{"body": "A Map would work too, but we use a plain object here because..."}'
```

Always reply to a thread you have handled, even if only to say you need clarification: a thread with no answer keeps waiting, and the loop will hand it back to you.

Then go back to step 3 with the new `version`. Keep looping until the user says the review is over or the server stops (`curl` fails to connect).

The `side` field tells you whether the comment is on an added line (`additions`) or a deleted line (`deletions`). `lineNumber` is the commented line, and `lineContent` is its content.

A reply posted this way is recorded as coming from the agent; the reviewer can answer it from the page, and the thread can go back and forth any number of times.

### 5. Edge cases

- If a comment is ambiguous, reply to ask for clarification rather than guessing.
- If several comments in a batch interact (e.g., a rename touching several places), handle them together, then reply to each.
- If the user asks for a one-off sweep of everything still open instead of the live loop, use `/assetto-diffx-finish-review`.
