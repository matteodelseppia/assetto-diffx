import { describe, it, expect } from 'vitest'
import { isAwaitingAgent, awaitingAgent, CommentWatch } from '../../src/comments.js'
import { parseWaitQuery, DEFAULT_WAIT_MS, MAX_WAIT_MS } from '../../src/server.js'
import type { ReviewComment, CommentReply } from '../../src/types.js'

function reply(author: CommentReply['author']): CommentReply {
  return { id: crypto.randomUUID(), body: `from ${author}`, createdAt: 1, author }
}

function comment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: crypto.randomUUID(),
    filePath: 'src/a.ts',
    side: 'additions',
    lineNumber: 1,
    lineContent: 'const a = 1',
    body: 'take a look',
    status: 'open',
    createdAt: 1,
    replies: [],
    ...overrides,
  }
}

describe('isAwaitingAgent', () => {
  it('waits for an answer to a fresh comment', () => {
    expect(isAwaitingAgent(comment())).toBe(true)
  })

  it('stops waiting once the agent has replied last', () => {
    expect(isAwaitingAgent(comment({ replies: [reply('agent')] }))).toBe(false)
  })

  it('waits again when the reviewer follows up on an answer', () => {
    expect(isAwaitingAgent(comment({ replies: [reply('agent'), reply('user')] }))).toBe(true)
  })

  it('leaves a resolved thread alone', () => {
    expect(isAwaitingAgent(comment({ status: 'resolved' }))).toBe(false)
  })

  it('waits when the reviewer replies to a resolved thread', () => {
    expect(isAwaitingAgent(comment({ status: 'resolved', replies: [reply('agent'), reply('user')] }))).toBe(true)
  })

  it('returns every waiting thread of a batch', () => {
    const waiting = [comment(), comment({ replies: [reply('agent'), reply('user')] })]
    const answered = comment({ replies: [reply('agent')] })
    expect(awaitingAgent([waiting[0], answered, waiting[1]]).map((c) => c.id)).toEqual([waiting[0].id, waiting[1].id])
  })
})

describe('CommentWatch', () => {
  it('wakes every waiter when the store changes', async () => {
    const watch = new CommentWatch()
    const waits = [watch.waitForChange(0, 5_000), watch.waitForChange(0, 5_000)]
    watch.bump()
    await Promise.all(waits)
    expect(watch.currentVersion).toBe(1)
  })

  it('returns at once when the version already moved past the caller', async () => {
    const watch = new CommentWatch()
    watch.bump()
    // A zero timeout would also resolve, so the test only means something if
    // the wait cannot be satisfied by waiting.
    await watch.waitForChange(0, 60_000)
  })

  it('gives up after the timeout when nothing changes', async () => {
    const watch = new CommentWatch()
    const started = Date.now()
    await watch.waitForChange(0, 20)
    expect(Date.now() - started).toBeGreaterThanOrEqual(15)
  })
})

describe('parseWaitQuery', () => {
  it('defaults to the whole current state and the default wait', () => {
    expect(parseWaitQuery(undefined, undefined)).toEqual({ since: 0, timeoutMs: DEFAULT_WAIT_MS })
  })

  it("reads the caller's version and timeout", () => {
    expect(parseWaitQuery('7', '1000')).toEqual({ since: 7, timeoutMs: 1000 })
  })

  it('caps the wait', () => {
    expect(parseWaitQuery(undefined, String(MAX_WAIT_MS * 10))).toEqual({ since: 0, timeoutMs: MAX_WAIT_MS })
  })

  it('rejects nonsense', () => {
    expect(parseWaitQuery('-1', undefined)).toEqual({ error: 'since must be a non-negative integer' })
    expect(parseWaitQuery('x', undefined)).toEqual({ error: 'since must be a non-negative integer' })
    expect(parseWaitQuery(undefined, '1.5')).toEqual({ error: 'timeout must be a non-negative integer' })
  })
})
