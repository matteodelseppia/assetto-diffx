import { describe, it, expect } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { COMMENTS_KEY, patchCachedComments } from '../../src/ui/hooks/useComments.js'
import type { ReviewComment } from '../../src/types.js'

function comment(id: string): ReviewComment {
  return {
    id,
    filePath: 'src/a.ts',
    side: 'additions',
    lineNumber: 1,
    lineContent: 'const a = 1',
    body: `comment ${id}`,
    status: 'open',
    createdAt: 1,
    replies: [],
  }
}

/**
 * A poll that has already been sent when the mutation succeeds. It carries the
 * list as it was before the mutation, so if it is allowed to land last it
 * silently undoes the mutation.
 */
function startStalePoll(queryClient: QueryClient, snapshot: ReviewComment[]) {
  let release!: () => void
  const inFlight = new Promise<void>((resolve) => {
    release = resolve
  })
  const poll = queryClient
    .fetchQuery({ queryKey: COMMENTS_KEY, queryFn: async () => {
      await inFlight
      return snapshot
    } })
    // A cancelled fetch rejects; that is the point of the fix.
    .catch(() => {})
  return { release, settled: poll }
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
}

describe('patchCachedComments', () => {
  it('keeps an added comment when a poll from before the mutation lands after it', async () => {
    const queryClient = newClient()
    const existing = [comment('a')]
    queryClient.setQueryData(COMMENTS_KEY, existing)

    const poll = startStalePoll(queryClient, existing)
    await patchCachedComments(queryClient, (prev) => [...prev, comment('b')])
    poll.release()
    await poll.settled

    expect(queryClient.getQueryData<ReviewComment[]>(COMMENTS_KEY)?.map((c) => c.id)).toEqual(['a', 'b'])
  })

  it('keeps a deletion when such a poll lands after it', async () => {
    const queryClient = newClient()
    const existing = [comment('a'), comment('b')]
    queryClient.setQueryData(COMMENTS_KEY, existing)

    const poll = startStalePoll(queryClient, existing)
    await patchCachedComments(queryClient, (prev) => prev.filter((c) => c.id !== 'a'))
    poll.release()
    await poll.settled

    expect(queryClient.getQueryData<ReviewComment[]>(COMMENTS_KEY)?.map((c) => c.id)).toEqual(['b'])
  })

  it('keeps a resolve when such a poll lands after it', async () => {
    const queryClient = newClient()
    const existing = [comment('a')]
    queryClient.setQueryData(COMMENTS_KEY, existing)

    const poll = startStalePoll(queryClient, existing)
    await patchCachedComments(queryClient, (prev) =>
      prev.map((c) => (c.id === 'a' ? { ...c, status: 'resolved' as const } : c)),
    )
    poll.release()
    await poll.settled

    expect(queryClient.getQueryData<ReviewComment[]>(COMMENTS_KEY)?.[0].status).toBe('resolved')
  })

  it('starts from an empty list when nothing is cached yet', async () => {
    const queryClient = newClient()
    await patchCachedComments(queryClient, (prev) => [...prev, comment('a')])
    expect(queryClient.getQueryData<ReviewComment[]>(COMMENTS_KEY)?.map((c) => c.id)).toEqual(['a'])
  })
})
