import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createFixtureRepo, removeRepo, startCli, type RunningServer } from './helpers.js'

let repo: string
let server: RunningServer

async function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${server.url}${path}`, init)
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await api(path, init)
  expect(res.ok, `${path} responded ${res.status}`).toBe(true)
  return (await res.json()) as T
}

beforeAll(async () => {
  repo = createFixtureRepo()
  server = await startCli(repo)
})

afterAll(async () => {
  await server?.stop()
  if (repo) removeRepo(repo)
})

describe('GET /api/diff', () => {
  it('reports the repository name and branch', async () => {
    const body = await json<{ repoName: string; branch: string; customMode: boolean }>('/api/diff')
    expect(body.repoName).toBe(repo.split('/').pop())
    expect(body.branch).toBe('main')
    expect(body.customMode).toBe(false)
  })

  it('includes unstaged changes by default', async () => {
    const { patch } = await json<{ patch: string }>('/api/diff')
    expect(patch).toContain('src/modified.ts')
    expect(patch).toContain('+export const value = 42')
  })

  it('includes staged changes only when asked', async () => {
    const without = await json<{ patch: string }>('/api/diff')
    expect(without.patch).not.toContain('+export const staged = 99')
    const withStaged = await json<{ patch: string }>('/api/diff?staged=true')
    expect(withStaged.patch).toContain('+export const staged = 99')
  })

  it('includes untracked files only when asked', async () => {
    const without = await json<{ untrackedFiles: string[]; patch: string }>('/api/diff')
    expect(without.untrackedFiles).toEqual([])
    const withUntracked = await json<{ untrackedFiles: string[]; patch: string }>('/api/diff?untracked=true')
    expect(withUntracked.untrackedFiles).toEqual(['src/untracked.ts'])
    expect(withUntracked.patch).toContain('+export const fresh = true')
  })
})

describe('GET /api/file-content', () => {
  it('serves the new version from the worktree', async () => {
    const res = await api('/api/file-content?path=src/modified.ts&version=new')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('export const value = 42')
  })

  it('serves the old version from HEAD', async () => {
    const res = await api('/api/file-content?path=src/modified.ts&version=old')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('export const value = 1')
  })

  it('rejects requests missing parameters', async () => {
    expect((await api('/api/file-content?path=src/modified.ts')).status).toBe(400)
  })

  it('refuses to read outside the repository', async () => {
    expect((await api('/api/file-content?path=../../etc/passwd&version=new')).status).toBe(404)
    expect((await api('/api/file-content?path=%2e%2e%2fetc%2fpasswd&version=new')).status).toBe(404)
  })
})

describe('GET /api/file-versions', () => {
  it('returns both sides for a file in the current diff', async () => {
    const { patch } = await json<{ patch: string }>('/api/diff')
    const oids = patch.match(/^index ([0-9a-f]+)\.\.([0-9a-f]+)/m)
    expect(oids).not.toBeNull()
    const body = await json<{ old: string; new: string }>(
      `/api/file-versions?path=src/modified.ts&oldOid=${oids![1]}&newOid=${oids![2]}`,
    )
    expect(body.old).toContain('export const value = 1')
    expect(body.new).toContain('export const value = 42')
  })

  it('rejects oids that are not part of the current diff', async () => {
    const res = await api('/api/file-versions?path=src/modified.ts&oldOid=1234567&newOid=7654321')
    expect(res.status).toBe(404)
  })

  it('rejects requests missing oids', async () => {
    expect((await api('/api/file-versions?path=src/modified.ts')).status).toBe(400)
  })
})

describe('/api/comments', () => {
  it('supports the full comment lifecycle', async () => {
    expect(await json<unknown[]>('/api/comments')).toEqual([])

    const created = await json<{ id: string; status: string; body: string; replies: unknown[] }>('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filePath: 'src/modified.ts',
        side: 'additions',
        startLineNumber: 1,
        lineNumber: 1,
        lineContents: ['export const value = 42'],
        body: 'why 42?',
      }),
    })
    expect(created.status).toBe('open')
    expect(created.body).toBe('why 42?')

    const edited = await json<{ body: string }>(`/api/comments/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'why not 43?' }),
    })
    expect(edited.body).toBe('why not 43?')

    const replied = await json<{ replies: { body: string }[] }>(`/api/comments/${created.id}/replies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'because' }),
    })
    expect(replied.replies.map((r) => r.body)).toEqual(['because'])

    const resolved = await json<{ status: string }>(`/api/comments/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'resolved' }),
    })
    expect(resolved.status).toBe('resolved')

    expect((await api(`/api/comments/${created.id}`, { method: 'DELETE' })).status).toBe(200)
    expect(await json<unknown[]>('/api/comments')).toEqual([])
  })

  it('refuses a comment that is missing what anchors it', async () => {
    const post = (payload: unknown) =>
      api('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

    // No line number and no path: what used to be stored as a comment with
    // null line numbers and no file.
    const bare = await post({ side: 'deletions', body: 'hi' })
    expect(bare.status).toBe(400)
    expect((await bare.json()).error).toMatch(/filePath/)

    expect((await post({ filePath: 'src/modified.ts', side: 'deletions', body: 'hi' })).status).toBe(400)
    expect((await post({ filePath: 'src/modified.ts', side: 'sideways', lineNumber: 1, body: 'hi' })).status).toBe(400)
    expect((await post({ filePath: 'src/modified.ts', side: 'deletions', lineNumber: 1 })).status).toBe(400)

    // Nothing of the above reached the store.
    expect(await json<unknown[]>('/api/comments')).toEqual([])
  })

  it('refuses a body that is not JSON', async () => {
    const res = await api('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    })
    expect(res.status).toBe(400)
  })

  it('404s on unknown comment ids', async () => {
    expect((await api('/api/comments/missing', { method: 'DELETE' })).status).toBe(404)
    expect(
      (
        await api('/api/comments/missing', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: 'x' }),
        })
      ).status,
    ).toBe(404)
    expect(
      (
        await api('/api/comments/missing/replies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: 'x' }),
        })
      ).status,
    ).toBe(404)
  })
})

describe('/api/viewed', () => {
  it('tracks viewed files with their content hash', async () => {
    expect(await json<Record<string, string>>('/api/viewed')).toEqual({})

    await json('/api/viewed', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: 'src/modified.ts', viewed: true, contentHash: 'abc123' }),
    })
    expect(await json<Record<string, string>>('/api/viewed')).toEqual({ 'src/modified.ts': 'abc123' })

    await json('/api/viewed', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: 'src/modified.ts', viewed: false }),
    })
    expect(await json<Record<string, string>>('/api/viewed')).toEqual({})
  })

  it('rejects marking a file viewed without a content hash', async () => {
    const res = await api('/api/viewed', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: 'src/modified.ts', viewed: true }),
    })
    expect(res.status).toBe(400)
  })
})

describe('/api/settings', () => {
  it('returns defaults and persists updates', async () => {
    const defaults = await json<{ diffStyle: string; defaultTabSize: number }>('/api/settings')
    expect(defaults.diffStyle).toBe('split')

    const updated = await json<{ diffStyle: string; defaultTabSize: number }>('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ diffStyle: 'unified' }),
    })
    expect(updated.diffStyle).toBe('unified')
    expect(updated.defaultTabSize).toBe(4)

    expect((await json<{ diffStyle: string }>('/api/settings')).diffStyle).toBe('unified')
  })
})

describe('static client', () => {
  it('serves the built web UI at the root', async () => {
    const res = await api('/')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(await res.text()).toContain('<div id="root">')
  })

  it('falls back to index.html for unknown routes', async () => {
    const res = await api('/some/client/route')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('<div id="root">')
  })

  it('refuses path traversal outside the client directory', async () => {
    const res = await fetch(`${server.url}/..%2f..%2fpackage.json`)
    expect(res.status).toBe(403)
  })
})
