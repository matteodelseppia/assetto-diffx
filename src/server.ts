import { readFile } from 'node:fs/promises'
import { join, extname, resolve } from 'node:path'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { getGitDiff, getCustomGitDiff, getRangeDiff, getRecentCommits, isKnownCommit, areLinesPresentInWorktree, getRepoName, getBranchName, getFileContent, getBlobContent, getWorktreeFileContent, getTabSizeForFiles, getUntrackedFilePaths } from './git.js'
import { loadSettings, saveSettings } from './settings.js'
import { InMemoryCommentStore } from './comments.js'
import type { CommentStore } from './comments.js'
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

export function createApp(clientDir: string, customDiffArgs?: string[], commentStore?: CommentStore) {
  const app = new Hono()
  const isCustomMode = !!customDiffArgs
  const store = commentStore ?? new InMemoryCommentStore()
  const viewedFiles = new Map<string, string>()

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

  app.post('/api/comments', async (c) => {
    const body = await c.req.json()
    const lineContents: string[] = Array.isArray(body.lineContents) ? body.lineContents : []
    // A range selected upwards arrives with its ends reversed; the comment is
    // anchored to the last line either way.
    const startLineNumber = Math.min(body.startLineNumber ?? body.lineNumber, body.lineNumber)
    const lineNumber = Math.max(body.startLineNumber ?? body.lineNumber, body.lineNumber)
    // Comments are handed to a coding agent that works on the working tree, so
    // an added line the reviewer found in an older commit but that no longer
    // exists is not actionable. Deleted lines are exempt: they are absent by
    // definition.
    if (body.side === 'additions' && !areLinesPresentInWorktree(body.filePath, lineContents)) {
      return c.json(
        {
          error:
            lineContents.length > 1
              ? 'Some of these lines are no longer part of the latest version of the file, so they cannot be commented on.'
              : 'This line is no longer part of the latest version of the file, so it cannot be commented on.',
        },
        409,
      )
    }
    const comment = {
      id: crypto.randomUUID(),
      filePath: body.filePath,
      side: body.side,
      startLineNumber,
      lineNumber,
      lineContents,
      body: body.body,
      status: 'open' as const,
      createdAt: Date.now(),
      replies: [],
    }
    const created = await store.add(comment)
    return c.json(created, 201)
  })

  app.put('/api/comments/:id', async (c) => {
    const id = c.req.param('id')
    const { body, status } = await c.req.json()
    const updated = await store.update(id, { body, status })
    if (!updated) return c.json({ error: 'Comment not found' }, 404)
    return c.json(updated)
  })

  app.post('/api/comments/:id/replies', async (c) => {
    const commentId = c.req.param('id')
    const { body } = await c.req.json()
    const reply = {
      id: crypto.randomUUID(),
      body,
      createdAt: Date.now(),
    }
    const updated = await store.addReply(commentId, reply)
    if (!updated) return c.json({ error: 'Comment not found' }, 404)
    return c.json(updated)
  })

  app.delete('/api/comments/:id', async (c) => {
    const id = c.req.param('id')
    const removed = await store.remove(id)
    if (!removed) return c.json({ error: 'Comment not found' }, 404)
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

export function startServer(options: {
  port: number
  host: string
  clientDir: string
  customDiffArgs?: string[]
}): Promise<{ port: number }> {
  const app = createApp(options.clientDir, options.customDiffArgs)

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
