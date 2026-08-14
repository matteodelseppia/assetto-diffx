import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { git, removeRepo, startCli, type RunningServer } from './helpers.js'
import type { CommitSummary } from '../../src/types.js'

/**
 * A repository with three commits on one file, so a range can be selected
 * between any two of them:
 *   first  — `line one`
 *   second — adds `line two` and `line three`
 *   third  — rewrites `line two` as `line TWO` (so `line two` is gone for good)
 */
function createHistoryRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'assetto-diffx-history-'))
  git(dir, 'init', '-b', 'main')
  git(dir, 'config', 'user.email', 'ci@example.com')
  git(dir, 'config', 'user.name', 'CI')
  git(dir, 'config', 'commit.gpgsign', 'false')

  const file = join(dir, 'file.ts')
  writeFileSync(file, 'line one\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-m', 'first commit')

  writeFileSync(file, 'line one\nline two\nline three\n')
  git(dir, 'commit', '-am', 'second commit')

  writeFileSync(file, 'line one\nline TWO\nline three\n')
  git(dir, 'commit', '-am', 'third commit')

  return dir
}

let repo: string
let server: RunningServer
let commits: CommitSummary[]

async function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${server.url}${path}`, init)
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await api(path, init)
  expect(res.ok, `${path} responded ${res.status}`).toBe(true)
  return (await res.json()) as T
}

function postComment(body: Record<string, unknown>): Promise<Response> {
  return api('/api/comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeAll(async () => {
  repo = createHistoryRepo()
  server = await startCli(repo)
  commits = (await json<{ commits: CommitSummary[] }>('/api/commits')).commits
})

afterAll(async () => {
  await server?.stop()
  if (repo) removeRepo(repo)
})

describe('GET /api/commits', () => {
  it('lists the commits newest first', () => {
    expect(commits.map((c) => c.subject)).toEqual(['third commit', 'second commit', 'first commit'])
  })

  it('describes each commit', () => {
    const [newest] = commits
    expect(newest.sha).toMatch(/^[0-9a-f]{40}$/)
    expect(newest.sha.startsWith(newest.shortSha)).toBe(true)
    expect(newest.author).toBe('CI')
    expect(Number.isNaN(Date.parse(newest.date))).toBe(false)
  })
})

describe('GET /api/diff with a selected range', () => {
  it('diffs a commit against the working tree when only a base is given', async () => {
    const first = commits[2].sha
    const body = await json<{ patch: string; rangeMode: boolean }>(`/api/diff?base=${first}`)
    expect(body.rangeMode).toBe(true)
    expect(body.patch).toContain('+line TWO')
    expect(body.patch).toContain('+line three')
  })

  it('diffs two selected commits', async () => {
    const [third, second, first] = commits
    const oldRange = await json<{ patch: string }>(`/api/diff?base=${first.sha}&head=${second.sha}`)
    expect(oldRange.patch).toContain('+line two')
    expect(oldRange.patch).not.toContain('+line TWO')

    const newRange = await json<{ patch: string }>(`/api/diff?base=${second.sha}&head=${third.sha}`)
    expect(newRange.patch).toContain('+line TWO')
    expect(newRange.patch).toContain('-line two')
  })

  it('reports the default mode when no range is selected', async () => {
    const body = await json<{ rangeMode: boolean; patch: string }>('/api/diff')
    expect(body.rangeMode).toBe(false)
    expect(body.patch).toBe('')
  })

  it('rejects revisions that are not commits of this repository', async () => {
    expect((await api('/api/diff?base=HEAD~2')).status).toBe(400)
    expect((await api('/api/diff?base=0123456789abcdef0123456789abcdef01234567')).status).toBe(400)
    expect((await api(`/api/diff?head=${commits[0].sha}`)).status).toBe(400)
  })
})

describe('GET /api/file-content with a selected range', () => {
  it('serves both sides of the selected range, not HEAD and the worktree', async () => {
    const [, second, first] = commits
    const query = `path=file.ts&base=${first.sha}&head=${second.sha}`

    const oldSide = await api(`/api/file-content?${query}&version=old`)
    expect(oldSide.status).toBe(200)
    expect(await oldSide.text()).toBe('line one\n')

    const newSide = await api(`/api/file-content?${query}&version=new`)
    expect(newSide.status).toBe(200)
    expect(await newSide.text()).toBe('line one\nline two\nline three\n')
  })

  it('reads the new side from the working tree when the range ends there', async () => {
    const first = commits[2].sha
    const oldSide = await api(`/api/file-content?path=file.ts&base=${first}&version=old`)
    expect(await oldSide.text()).toBe('line one\n')

    const newSide = await api(`/api/file-content?path=file.ts&base=${first}&version=new`)
    expect(await newSide.text()).toBe('line one\nline TWO\nline three\n')
  })

  it('rejects a range whose ends are not commits of this repository', async () => {
    expect((await api('/api/file-content?path=file.ts&version=old&base=HEAD~2')).status).toBe(400)
    expect((await api(`/api/file-content?path=file.ts&version=old&head=${commits[0].sha}`)).status).toBe(400)
  })

  it('rejects an unknown version', async () => {
    expect((await api('/api/file-content?path=file.ts&version=staged')).status).toBe(400)
  })
})

describe('POST /api/comments on a selected range', () => {
  it('accepts an added line that still exists in the working tree', async () => {
    const res = await postComment({
      filePath: 'file.ts',
      side: 'additions',
      startLineNumber: 3,
      lineNumber: 3,
      lineContents: ['line three'],
      body: 'still here',
    })
    expect(res.status).toBe(201)
  })

  it('rejects an added line that later commits removed', async () => {
    const res = await postComment({
      filePath: 'file.ts',
      side: 'additions',
      startLineNumber: 2,
      lineNumber: 2,
      lineContents: ['line two'],
      body: 'gone in the latest version',
    })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/latest version/)
  })

  it('accepts a range whose every line still exists in the working tree', async () => {
    const res = await postComment({
      filePath: 'file.ts',
      side: 'additions',
      startLineNumber: 1,
      lineNumber: 3,
      lineContents: ['line one', 'line TWO', 'line three'],
      body: 'the whole file reads oddly',
    })
    expect(res.status).toBe(201)
    const created = await res.json()
    expect(created.startLineNumber).toBe(1)
    expect(created.lineNumber).toBe(3)
    expect(created.lineContents).toEqual(['line one', 'line TWO', 'line three'])
  })

  it('rejects a range in which one line no longer exists', async () => {
    const res = await postComment({
      filePath: 'file.ts',
      side: 'additions',
      startLineNumber: 1,
      lineNumber: 3,
      lineContents: ['line one', 'line two', 'line three'],
      body: 'one of these is stale',
    })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/no longer part of the latest version/)
  })

  it('orders the ends of a range that was selected upwards', async () => {
    const res = await postComment({
      filePath: 'file.ts',
      side: 'additions',
      startLineNumber: 3,
      lineNumber: 1,
      lineContents: ['line three', 'line TWO', 'line one'],
      body: 'dragged bottom to top',
    })
    expect(res.status).toBe(201)
    const created = await res.json()
    expect(created.startLineNumber).toBe(1)
    expect(created.lineNumber).toBe(3)
  })

  it('rejects a comment on a file that no longer exists', async () => {
    const res = await postComment({
      filePath: 'deleted.ts',
      side: 'additions',
      startLineNumber: 1,
      lineNumber: 1,
      lineContents: ['line one'],
      body: 'gone',
    })
    expect(res.status).toBe(409)
  })

  it('still accepts comments on deleted lines, which are absent by definition', async () => {
    const res = await postComment({
      filePath: 'file.ts',
      side: 'deletions',
      startLineNumber: 2,
      lineNumber: 2,
      lineContents: ['line two'],
      body: 'why was this changed?',
    })
    expect(res.status).toBe(201)
  })

  it('still accepts a range of deleted lines', async () => {
    const res = await postComment({
      filePath: 'file.ts',
      side: 'deletions',
      startLineNumber: 1,
      lineNumber: 2,
      lineContents: ['line one', 'line two'],
      body: 'both of these went away',
    })
    expect(res.status).toBe(201)
  })
})
