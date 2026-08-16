import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createFixtureRepo, removeRepo, startCli, type RunningServer } from './helpers.js'
import type { ReviewComment } from '../../src/types.js'

let repo: string
let server: RunningServer

interface PendingResponse {
  version: number
  comments: ReviewComment[]
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${server.url}${path}`, init)
  expect(res.ok, `${path} responded ${res.status}`).toBe(true)
  return (await res.json()) as T
}

function post(path: string, payload: unknown): Promise<Response> {
  return fetch(`${server.url}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

function comment(body: string, lineNumber = 1) {
  return {
    filePath: 'src/modified.ts',
    side: 'additions' as const,
    lineNumber,
    lineContent: lineNumber === 1 ? 'export const value = 42' : 'export const other = 2',
    body,
  }
}

/** Long poll for work, as the agent's loop does. */
function pending(since: number, timeoutMs = 5_000): Promise<PendingResponse> {
  return json<PendingResponse>(`/api/comments/pending?since=${since}&timeout=${timeoutMs}`)
}

async function clearComments(): Promise<void> {
  const comments = await json<ReviewComment[]>('/api/comments')
  await Promise.all(comments.map((c) => fetch(`${server.url}/api/comments/${c.id}`, { method: 'DELETE' })))
}

beforeAll(async () => {
  repo = createFixtureRepo()
  server = await startCli(repo)
})

afterAll(async () => {
  await server?.stop()
  if (repo) removeRepo(repo)
})

beforeEach(clearComments)

describe('GET /api/comments/pending', () => {
  it('hands a comment to the agent as soon as it is posted', async () => {
    const version = (await pending(0, 0)).version
    const waiting = pending(version)

    // Nothing has been posted yet, so the request is still open.
    const raced = await Promise.race([waiting.then(() => 'answered'), delay(100).then(() => 'still waiting')])
    expect(raced).toBe('still waiting')

    await post('/api/comments', comment('why 42?'))
    const work = await waiting
    expect(work.comments.map((c) => c.body)).toEqual(['why 42?'])
  })

  it('returns every comment of a burst, so none goes unanswered', async () => {
    const version = (await pending(0, 0)).version
    await Promise.all([
      post('/api/comments', comment('first', 1)),
      post('/api/comments', comment('second', 2)),
      post('/api/comments', comment('third', 1)),
    ])

    const work = await pending(version)
    expect(work.comments.map((c) => c.body).sort()).toEqual(['first', 'second', 'third'])
  })

  it('drops a thread once the agent has answered it, and brings it back on a follow-up', async () => {
    const version = (await pending(0, 0)).version
    const created = (await (await post('/api/comments', comment('why 42?'))).json()) as ReviewComment

    const first = await pending(version)
    expect(first.comments.map((c) => c.id)).toEqual([created.id])

    await post(`/api/comments/${created.id}/replies`, { body: 'because it is the answer' })
    const afterAnswer = await pending(first.version, 100)
    expect(afterAnswer.comments).toEqual([])

    await post(`/api/comments/${created.id}/replies`, { body: 'the answer to what?', author: 'user' })
    const followUp = await pending(afterAnswer.version)
    expect(followUp.comments.map((c) => c.id)).toEqual([created.id])
  })

  it('waits again for work the agent already saw but has not answered', async () => {
    const version = (await pending(0, 0)).version
    await post('/api/comments', comment('why 42?'))

    const seen = await pending(version)
    expect(seen.comments).toHaveLength(1)

    // Asking again without having replied does not spin: the poll blocks until
    // something actually changes.
    const started = Date.now()
    const again = await pending(seen.version, 150)
    expect(again.comments).toEqual([])
    expect(Date.now() - started).toBeGreaterThanOrEqual(100)
  })

  it('comes back empty when the wait runs out', async () => {
    const version = (await pending(0, 0)).version
    const work = await pending(version, 100)
    expect(work.comments).toEqual([])
    expect(work.version).toBe(version)
  })

  it('rejects a nonsensical wait', async () => {
    const res = await fetch(`${server.url}/api/comments/pending?since=-3`)
    expect(res.status).toBe(400)
  })
})

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
