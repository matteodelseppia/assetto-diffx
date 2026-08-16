import { readFile } from 'node:fs/promises'
import { join, extname, resolve } from 'node:path'
import { timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { serve } from '@hono/node-server'
import { getGitDiff, getCustomGitDiff, getRangeDiff, getRecentCommits, isKnownCommit, isLinePresentInWorktree, getRepoName, getBranchName, getFileContent, getBlobContent, getWorktreeFileContent, getTabSizeForFiles, getUntrackedFilePaths } from './git.js'
import { loadSettings, saveSettings } from './settings.js'
import { InMemoryCommentStore, CommentWatch, awaitingAgent } from './comments.js'
import type { CommentStore } from './comments.js'
import type { CommentReply, ReviewComment } from './types.js'
import { isSafePath } from './path.js'

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
}

export interface BinaryFileInfo {
  path: string
  type: 'added' | 'deleted' | 'changed' | 'untracked'
}

/** Splits a patch into one chunk per file. */
function splitChunks(patch: string): string[] {
  return patch.split(/^(?=diff --git )/m).filter((chunk) => chunk.startsWith('diff --git '))
}

/**
 * The path a per-file chunk describes. `diff --git a/<old> b/<new>` is
 * ambiguous for a path containing " b/", so the unambiguous headers are
 * preferred: `+++ b/<path>`, `rename to <path>`, or — for a deletion, whose new
 * side is /dev/null — `--- a/<path>`. A binary chunk has none of those, but its
 * `diff --git` line can still be read whenever both sides are the same path,
 * which fixes its length: everything but a rename.
 */
export function parseChunkPath(chunk: string): string | null {
  const newHeader = chunk.match(/^\+\+\+ b\/([^\t\r\n]+)/m)
  if (newHeader) return newHeader[1].trim()

  const renameTo = chunk.match(/^rename to (.+)$/m)
  if (renameTo) return renameTo[1].trim()

  const oldHeader = chunk.match(/^--- a\/([^\t\r\n]+)/m)
  if (oldHeader) return oldHeader[1].trim()

  const gitLine = chunk.match(/^diff --git (.+)$/m)
  if (gitLine) {
    const sides = gitLine[1].trim()
    // `a/<path> b/<path>` — the separators take five characters, so what
    // remains splits evenly between the two identical paths.
    if ((sides.length - 5) % 2 === 0) {
      const path = sides.slice(2, 2 + (sides.length - 5) / 2)
      if (sides === `a/${path} b/${path}`) return path
    }
  }

  return null
}

export function parseFilePaths(patch: string): string[] {
  const paths = new Set<string>()
  for (const chunk of splitChunks(patch)) {
    const path = parseChunkPath(chunk)
    if (path) paths.add(path)
  }
  return [...paths]
}

export function parseBinaryFiles(patch: string, untrackedFiles?: Set<string>): BinaryFileInfo[] {
  const binaryFiles: BinaryFileInfo[] = []
  for (const chunk of splitChunks(patch)) {
    const lines = chunk.split('\n')
    if (!lines.some((line) => line.startsWith('Binary files ') && line.includes(' differ'))) continue

    const filePath = parseChunkPath(chunk)
    if (!filePath) continue

    let changeType: BinaryFileInfo['type'] = 'changed'
    if (lines.some((line) => line.startsWith('new file mode'))) changeType = 'added'
    else if (lines.some((line) => line.startsWith('deleted file mode'))) changeType = 'deleted'

    if (changeType === 'added' && untrackedFiles?.has(filePath)) {
      changeType = 'untracked'
    }
    binaryFiles.push({ path: filePath, type: changeType })
  }
  return binaryFiles
}

export function diffContainsFileVersion(patch: string, path: string, oldOid: string, newOid: string): boolean {
  for (const chunk of patch.split(/^(?=diff --git )/m)) {
    // Match the new-file path from the `+++ b/<path>` header (as the client
    // does); the `diff --git` line is ambiguous for paths containing ` b/`.
    const nameMatch = chunk.match(/^\+\+\+ [ab]\/([^\t\r\n]+)/m)
    if (!nameMatch || nameMatch[1].trim() !== path) continue
    const indexMatch = chunk.match(/^index ([0-9a-f]+)\.\.([0-9a-f]+)/m)
    if (indexMatch && indexMatch[1] === oldOid && indexMatch[2] === newOid) return true
  }
  return false
}

/** A comment payload that has been checked before anything is stored. */
export interface CommentInput {
  filePath: string
  side: ReviewComment['side']
  lineNumber: number
  lineContent: string
  body: string
}

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''
const isLineNumber = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0

/**
 * Checks a posted comment before it reaches the store. Anything stored is
 * served back to every client, exported to the coding agent, and anchored to a
 * line in the diff, so a missing line number or file path is not something to
 * carry around as `NaN` or `undefined` — it is a bad request.
 */
export function parseCommentInput(payload: unknown): { input: CommentInput } | { error: string } {
  if (typeof payload !== 'object' || payload === null) {
    return { error: 'Body must be a JSON object' }
  }
  const body = payload as Record<string, unknown>

  if (!isNonEmptyString(body.filePath)) return { error: 'filePath must be a non-empty string' }
  if (body.side !== 'additions' && body.side !== 'deletions') {
    return { error: "side must be 'additions' or 'deletions'" }
  }
  if (!isNonEmptyString(body.body)) return { error: 'body must be a non-empty string' }
  if (!isLineNumber(body.lineNumber)) return { error: 'lineNumber must be a positive integer' }
  if (body.lineContent !== undefined && typeof body.lineContent !== 'string') {
    return { error: 'lineContent must be a string' }
  }

  return {
    input: {
      filePath: body.filePath,
      side: body.side,
      lineNumber: body.lineNumber,
      lineContent: (body.lineContent as string | undefined) ?? '',
      body: body.body,
    },
  }
}

/** A reply payload that has been checked before anything is stored. */
export interface ReplyInput {
  body: string
  author: CommentReply['author']
}

/**
 * Checks a posted reply. The coding agent replies with a plain `{ body }` — it
 * is the only writer that reaches the API directly — so an absent author is
 * read as the agent; the page sends its own author explicitly.
 */
export function parseReplyInput(payload: unknown): { input: ReplyInput } | { error: string } {
  if (typeof payload !== 'object' || payload === null) {
    return { error: 'Body must be a JSON object' }
  }
  const body = payload as Record<string, unknown>
  if (!isNonEmptyString(body.body)) return { error: 'body must be a non-empty string' }
  if (body.author !== undefined && body.author !== 'user' && body.author !== 'agent') {
    return { error: "author must be 'user' or 'agent'" }
  }
  return { input: { body: body.body, author: (body.author as ReplyInput['author'] | undefined) ?? 'agent' } }
}

/** How long an agent's long poll waits for a comment before coming back empty. */
export const DEFAULT_WAIT_MS = 30_000
/** Upper bound on that wait, so a request can never park for good. */
export const MAX_WAIT_MS = 300_000

export interface WaitQuery {
  /** The version the caller last saw; it is told about anything newer. */
  since: number
  timeoutMs: number
}

/**
 * Reads the `since`/`timeout` query parameters of the agent's long poll.
 * Absent parameters mean "whatever there is, right now, for up to the default
 * wait" — the shape of a first call.
 */
export function parseWaitQuery(since: string | undefined, timeout: string | undefined): WaitQuery | { error: string } {
  let sinceVersion = 0
  if (since !== undefined) {
    const parsed = Number(since)
    if (!Number.isInteger(parsed) || parsed < 0) return { error: 'since must be a non-negative integer' }
    sinceVersion = parsed
  }
  let timeoutMs = DEFAULT_WAIT_MS
  if (timeout !== undefined) {
    const parsed = Number(timeout)
    if (!Number.isInteger(parsed) || parsed < 0) return { error: 'timeout must be a non-negative integer' }
    timeoutMs = Math.min(parsed, MAX_WAIT_MS)
  }
  return { since: sinceVersion, timeoutMs }
}

/** Number of commits offered in the browser's range picker. */
export const COMMIT_LIST_LIMIT = 100

export interface CommitRange {
  base: string
  /** Omitted when the range ends at the working tree. */
  head?: string
}

/**
 * Reads the `base`/`head` query parameters into a commit range. Returns `null`
 * when no range was requested and `'invalid'` when an end does not resolve to a
 * commit in this repository — the picker only ever sends ids it was served,
 * so anything else is a stale page or a hand-written request.
 */
export function parseRangeQuery(
  base: string | undefined,
  head: string | undefined,
  isCommit: (sha: string) => boolean = isKnownCommit,
): CommitRange | null | 'invalid' {
  if (!base) return head ? 'invalid' : null
  if (!isCommit(base)) return 'invalid'
  if (!head) return { base }
  if (!isCommit(head)) return 'invalid'
  return { base, head }
}

/** Cookie the browser keeps the access token in once it has followed the link. */
export const TOKEN_COOKIE = 'assetto_diffx_token'

function tokenMatches(expected: string, provided: string | undefined): boolean {
  if (!provided || provided.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
}

export function createApp(
  clientDir: string,
  customDiffArgs?: string[],
  commentStore?: CommentStore,
  /**
   * Required on every request when set. The CLI generates one whenever the
   * server is bound past loopback, where the repository would otherwise be
   * readable and commentable by anyone who can reach the port.
   */
  authToken?: string,
) {
  const app = new Hono()
  const isCustomMode = !!customDiffArgs
  const store = commentStore ?? new InMemoryCommentStore()
  const watch = new CommentWatch()
  const viewedFiles = new Map<string, string>()

  if (authToken) {
    app.use('*', async (c, next) => {
      // The token arrives in the link the CLI prints; it is exchanged for a
      // cookie so the page's own asset and API requests carry it from then on.
      const fromQuery = c.req.query('token')
      const provided = fromQuery ?? c.req.header('x-auth-token') ?? getCookie(c, TOKEN_COOKIE)
      if (!tokenMatches(authToken, provided)) {
        return c.text('Unauthorized', 401)
      }
      await next()
      // After the handler: a route that returns a Response of its own replaces
      // the one the cookie would have been written to.
      if (fromQuery) {
        setCookie(c, TOKEN_COOKIE, authToken, { path: '/', httpOnly: true, sameSite: 'Strict' })
      }
    })
  }

  // An explicit range picked in the browser wins over both the CLI's custom
  // diff arguments and the working-tree default.
  const buildPatch = (range: CommitRange | null, staged: boolean, untracked: boolean): string => {
    if (range) return getRangeDiff(range.base, range.head)
    if (isCustomMode) return getCustomGitDiff(customDiffArgs)
    return getGitDiff({ staged, untracked })
  }

  app.get('/api/commits', (c) => {
    return c.json({ commits: getRecentCommits(COMMIT_LIST_LIMIT) })
  })

  app.get('/api/diff', (c) => {
    const staged = c.req.query('staged') === 'true'
    const untracked = c.req.query('untracked') === 'true'
    const range = parseRangeQuery(c.req.query('base'), c.req.query('head'))
    if (range === 'invalid') {
      return c.json({ error: 'Unknown commit in requested range' }, 400)
    }
    const patch = buildPatch(range, staged, untracked)
    const repoName = getRepoName()
    const branch = getBranchName()
    // Untracked files are not part of any commit, so they never belong to a
    // commit range.
    const untrackedFiles = untracked && !range ? getUntrackedFilePaths() : []
    const untrackedSet = new Set(untrackedFiles)
    const binaryFiles = parseBinaryFiles(patch, untrackedSet)
    const filePaths = parseFilePaths(patch)
    const tabSizeMap = getTabSizeForFiles(filePaths)
    return c.json({
      patch,
      repoName,
      branch,
      customMode: isCustomMode,
      rangeMode: !!range,
      binaryFiles,
      tabSizeMap,
      untrackedFiles,
    })
  })

  app.get('/api/file-content', (c) => {
    const path = c.req.query('path')
    const version = c.req.query('version')
    if (!path || (version !== 'old' && version !== 'new')) {
      return c.json({ error: 'Missing path or version' }, 400)
    }
    const range = parseRangeQuery(c.req.query('base'), c.req.query('head'))
    if (range === 'invalid') {
      return c.json({ error: 'Unknown commit in requested range' }, 400)
    }
    // Both sides have to come from the same range the diff was built from: the
    // old side is the range's base, the new side its head — or the working tree
    // when the range ends there, which is also the default (HEAD..worktree).
    const revision = version === 'old' ? (range?.base ?? 'HEAD') : range?.head
    const content = getFileContent(path, revision)
    if (!content) {
      return c.json({ error: 'File not found' }, 404)
    }
    const ext = extname(path)
    const contentType = MIME_TYPES[ext] || 'application/octet-stream'
    return new Response(new Uint8Array(content), {
      headers: { 'Content-Type': contentType },
    })
  })

  // Full old/new file contents for a diffed file, so the client can build a
  // non-partial diff that supports expanding context around hunks.
  // `oldOid`/`newOid` are blob ids from the patch's `index` line. The diff is
  // regenerated and the requested oids must match its `index` line for the
  // requested path: this keeps arbitrary repository blobs unreachable, and
  // rejects requests whose patch no longer matches the worktree (git recomputes
  // the worktree blob hash on every diff, so any edit changes the new oid).
  app.get('/api/file-versions', (c) => {
    const path = c.req.query('path')
    const oldOid = c.req.query('oldOid')
    const newOid = c.req.query('newOid')
    if (!path || !oldOid || !newOid) {
      return c.json({ error: 'Missing path or oids' }, 400)
    }
    const staged = c.req.query('staged') === 'true'
    const untracked = c.req.query('untracked') === 'true'
    const range = parseRangeQuery(c.req.query('base'), c.req.query('head'))
    if (range === 'invalid') {
      return c.json({ error: 'Unknown commit in requested range' }, 400)
    }
    const patch = buildPatch(range, staged, untracked)
    if (!diffContainsFileVersion(patch, path, oldOid, newOid)) {
      return c.json({ error: 'File version not in current diff' }, 404)
    }
    // A zero oid is git's `/dev/null` — an absent side (creation/deletion), so
    // its content is empty. A non-zero oid that is missing from the object
    // database is the worktree blob of an unstaged change (git computes its
    // hash without storing it), so fall back to reading the worktree.
    const oldContent = /^0+$/.test(oldOid) ? '' : getBlobContent(oldOid)
    const newContent = /^0+$/.test(newOid) ? '' : getBlobContent(newOid) ?? getWorktreeFileContent(path)
    if (oldContent == null || newContent == null) {
      return c.json({ error: 'Content unavailable' }, 404)
    }
    return c.json({ old: oldContent, new: newContent })
  })

  app.get('/api/settings', (c) => {
    return c.json(loadSettings())
  })

  app.put('/api/settings', async (c) => {
    const body = await c.req.json()
    const settings = saveSettings(body)
    return c.json(settings)
  })

  app.get('/api/viewed', (c) => {
    return c.json(Object.fromEntries(viewedFiles))
  })

  app.put('/api/viewed', async (c) => {
    const { filePath, viewed, contentHash } = await c.req.json<{ filePath: string; viewed: boolean; contentHash?: string }>()
    if (viewed) {
      if (typeof contentHash !== 'string' || contentHash.length === 0) {
        return c.json({ error: 'non-empty contentHash required when marking viewed' }, 400)
      }
      viewedFiles.set(filePath, contentHash)
    } else {
      viewedFiles.delete(filePath)
    }
    return c.json({ ok: true })
  })

  app.get('/api/comments', async (c) => {
    const comments = await store.getAll()
    return c.json(comments)
  })

  /**
   * The agent's live feed of work. It holds the request open until a thread is
   * waiting on an answer, so a comment reaches the agent as soon as it is
   * posted instead of at the end of the review. Every waiting thread is
   * returned together, which is what keeps a burst of comments posted at once
   * from losing any of them.
   */
  app.get('/api/comments/pending', async (c) => {
    const parsed = parseWaitQuery(c.req.query('since'), c.req.query('timeout'))
    if ('error' in parsed) {
      return c.json({ error: parsed.error }, 400)
    }
    return c.json(await collectPending(parsed.since, Date.now() + parsed.timeoutMs))
  })

  /**
   * Waits for threads the agent has not answered, up to `deadline`. The version
   * is read before the threads are, so a comment posted while they are being
   * read is a version the wait already knows to skip past instead of sleeping
   * through. Coming back empty means the wait ran out, not that the caller
   * should stop asking.
   */
  async function collectPending(since: number, deadline: number): Promise<{ version: number; comments: ReviewComment[] }> {
    const version = watch.currentVersion
    const comments = awaitingAgent(await store.getAll())
    if (version > since && comments.length > 0) {
      return { version, comments }
    }
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      return { version, comments: [] }
    }
    await watch.waitForChange(version, remaining)
    return collectPending(since, deadline)
  }

  app.post('/api/comments', async (c) => {
    let payload: unknown
    try {
      payload = await c.req.json()
    } catch {
      return c.json({ error: 'Body must be JSON' }, 400)
    }
    const parsed = parseCommentInput(payload)
    if ('error' in parsed) {
      return c.json({ error: parsed.error }, 400)
    }
    const { filePath, side, lineNumber, lineContent, body: text } = parsed.input
    // Comments are handed to a coding agent that works on the working tree, so
    // an added line the reviewer found in an older commit but that no longer
    // exists is not actionable. Deleted lines are exempt: they are absent by
    // definition.
    if (side === 'additions' && !isLinePresentInWorktree(filePath, lineContent)) {
      return c.json(
        { error: 'This line is no longer part of the latest version of the file, so it cannot be commented on.' },
        409,
      )
    }
    const comment = {
      id: crypto.randomUUID(),
      filePath,
      side,
      lineNumber,
      lineContent,
      body: text,
      status: 'open' as const,
      createdAt: Date.now(),
      replies: [],
    }
    const created = await store.add(comment)
    watch.bump()
    return c.json(created, 201)
  })

  app.put('/api/comments/:id', async (c) => {
    const id = c.req.param('id')
    const { body, status } = await c.req.json()
    const updated = await store.update(id, { body, status })
    if (!updated) return c.json({ error: 'Comment not found' }, 404)
    watch.bump()
    return c.json(updated)
  })

  app.post('/api/comments/:id/replies', async (c) => {
    const commentId = c.req.param('id')
    let payload: unknown
    try {
      payload = await c.req.json()
    } catch {
      return c.json({ error: 'Body must be JSON' }, 400)
    }
    const parsed = parseReplyInput(payload)
    if ('error' in parsed) {
      return c.json({ error: parsed.error }, 400)
    }
    const reply = {
      id: crypto.randomUUID(),
      body: parsed.input.body,
      createdAt: Date.now(),
      author: parsed.input.author,
    }
    const updated = await store.addReply(commentId, reply)
    if (!updated) return c.json({ error: 'Comment not found' }, 404)
    watch.bump()
    return c.json(updated)
  })

  app.delete('/api/comments/:id', async (c) => {
    const id = c.req.param('id')
    const removed = await store.remove(id)
    if (!removed) return c.json({ error: 'Comment not found' }, 404)
    watch.bump()
    return c.json({ ok: true })
  })

  app.get('/*', async (c) => {
    let filePath = c.req.path
    if (filePath === '/') filePath = '/index.html'

    const relativePath = filePath.slice(1)
    if (!isSafePath(relativePath, clientDir)) {
      return c.text('Forbidden', 403)
    }
    const fullPath = resolve(clientDir, relativePath)
    try {
      const content = await readFile(fullPath)
      const ext = extname(fullPath)
      const contentType = MIME_TYPES[ext] || 'application/octet-stream'
      return new Response(content, {
        headers: { 'Content-Type': contentType },
      })
    } catch {
      const indexContent = await readFile(join(clientDir, 'index.html'))
      return new Response(indexContent, {
        headers: { 'Content-Type': 'text/html' },
      })
    }
  })

  return app
}

/** Whether a bind address is reachable only from this machine. */
export function isLoopbackHost(host: string): boolean {
  return host.startsWith('127.') || host === 'localhost' || host === '::1' || host === '[::1]'
}

export function startServer(options: {
  port: number
  host: string
  clientDir: string
  customDiffArgs?: string[]
  authToken?: string
}): Promise<{ port: number }> {
  const app = createApp(options.clientDir, options.customDiffArgs, undefined, options.authToken)

  return new Promise((resolveStarted) => {
    serve({
      fetch: app.fetch,
      port: options.port,
      hostname: options.host,
    }, (info) => {
      resolveStarted({ port: info.port })
    })
  })
}
