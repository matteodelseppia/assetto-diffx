import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryCommentStore } from '../../src/comments.js'
import type { ReviewComment } from '../../src/types.js'

function makeComment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: 'c1',
    filePath: 'src/index.ts',
    side: 'additions',
    startLineNumber: 12,
    lineNumber: 12,
    lineContents: ['const x = 1'],
    body: 'nit: name this better',
    status: 'open',
    createdAt: 1_700_000_000_000,
    replies: [],
    ...overrides,
  }
}

describe('InMemoryCommentStore', () => {
  let store: InMemoryCommentStore

  beforeEach(() => {
    store = new InMemoryCommentStore()
  })

  it('starts empty', async () => {
    expect(await store.getAll()).toEqual([])
  })

  it('adds comments and returns them in insertion order', async () => {
    await store.add(makeComment({ id: 'a' }))
    await store.add(makeComment({ id: 'b' }))
    expect((await store.getAll()).map((c) => c.id)).toEqual(['a', 'b'])
  })

  it('updates the body of an existing comment', async () => {
    await store.add(makeComment())
    const updated = await store.update('c1', { body: 'reworded' })
    expect(updated?.body).toBe('reworded')
    expect(updated?.status).toBe('open')
  })

  it('updates the status of an existing comment', async () => {
    await store.add(makeComment())
    const updated = await store.update('c1', { status: 'resolved' })
    expect(updated?.status).toBe('resolved')
  })

  it('leaves untouched fields alone when updating', async () => {
    await store.add(makeComment())
    await store.update('c1', { status: 'resolved' })
    const [comment] = await store.getAll()
    expect(comment.body).toBe('nit: name this better')
  })

  it('returns null when updating a missing comment', async () => {
    expect(await store.update('nope', { body: 'x' })).toBeNull()
  })

  it('removes a comment', async () => {
    await store.add(makeComment({ id: 'a' }))
    await store.add(makeComment({ id: 'b' }))
    expect(await store.remove('a')).toBe(true)
    expect((await store.getAll()).map((c) => c.id)).toEqual(['b'])
  })

  it('returns false when removing a missing comment', async () => {
    expect(await store.remove('nope')).toBe(false)
  })

  it('appends replies to a comment', async () => {
    await store.add(makeComment())
    const updated = await store.addReply('c1', { id: 'r1', body: 'agreed', createdAt: 1, author: 'agent' })
    expect(updated?.replies).toEqual([{ id: 'r1', body: 'agreed', createdAt: 1, author: 'agent' }])
    await store.addReply('c1', { id: 'r2', body: 'done', createdAt: 2, author: 'agent' })
    const [comment] = await store.getAll()
    expect(comment.replies.map((r) => r.id)).toEqual(['r1', 'r2'])
  })

  it('keeps a back-and-forth thread in order, with each side attributed', async () => {
    await store.add(makeComment())
    await store.addReply('c1', { id: 'r1', body: 'done', createdAt: 1, author: 'agent' })
    await store.addReply('c1', { id: 'r2', body: 'and the other one?', createdAt: 2, author: 'user' })
    await store.addReply('c1', { id: 'r3', body: 'done too', createdAt: 3, author: 'agent' })
    const [comment] = await store.getAll()
    expect(comment.replies.map((r) => r.author)).toEqual(['agent', 'user', 'agent'])
  })

  it('returns null when replying to a missing comment', async () => {
    expect(await store.addReply('nope', { id: 'r1', body: 'hi', createdAt: 1, author: 'user' })).toBeNull()
  })
})
