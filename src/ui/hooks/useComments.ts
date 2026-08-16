import { useCallback, useState } from 'react'
import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { DiffLineAnnotation } from '@pierre/diffs'
import type { ReviewComment } from '../../types'
import { formatComments } from '../utils'

export const COMMENTS_KEY = ['comments']

/**
 * Applies a mutation's result to the cached list. The list is also polled every
 * few seconds, so a poll that is already in flight has to be cancelled first —
 * otherwise it resolves afterwards and overwrites the change with the snapshot
 * it took before the mutation, making the comment appear to revert.
 */
export async function patchCachedComments(
  queryClient: QueryClient,
  update: (prev: ReviewComment[]) => ReviewComment[],
): Promise<void> {
  await queryClient.cancelQueries({ queryKey: COMMENTS_KEY })
  queryClient.setQueryData<ReviewComment[]>(COMMENTS_KEY, (prev = []) => update(prev))
}

/** A comment as the reviewer wrote it, before the server assigns it an id. */
export type NewComment = Pick<ReviewComment, 'filePath' | 'side' | 'lineNumber' | 'lineContent' | 'body'>

async function fetchComments({ signal }: { signal: AbortSignal }): Promise<ReviewComment[]> {
  const res = await fetch('/api/comments', { signal })
  return res.json()
}

export function useComments() {
  const queryClient = useQueryClient()
  const [addError, setAddError] = useState<string | null>(null)
  const { data: comments = [] } = useQuery({ queryKey: COMMENTS_KEY, queryFn: fetchComments, refetchInterval: 3000 })

  const patchComments = useCallback(
    (update: (prev: ReviewComment[]) => ReviewComment[]) => patchCachedComments(queryClient, update),
    [queryClient],
  )

  const addMutation = useMutation({
    mutationFn: async (params: NewComment) => {
      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      const json = await res.json()
      if (!res.ok) {
        throw new Error(json?.error ?? `Could not save the comment (HTTP ${res.status})`)
      }
      return json as ReviewComment
    },
    onSuccess: (comment) => {
      setAddError(null)
      return patchComments((prev) => [...prev, comment])
    },
    onError: (err: Error) => {
      setAddError(err.message)
    },
  })

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/comments/${id}`, { method: 'DELETE' })
      return id
    },
    onSuccess: (id) => patchComments((prev) => prev.filter((c) => c.id !== id)),
  })

  const editMutation = useMutation({
    mutationFn: async ({ id, body, status }: { id: string; body?: string; status?: ReviewComment['status'] }) => {
      const res = await fetch(`/api/comments/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, status }),
      })
      return res.json() as Promise<ReviewComment>
    },
    onSuccess: (updated) => patchComments((prev) => prev.map((c) => (c.id === updated.id ? updated : c))),
  })

  const replyMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: string }) => {
      const res = await fetch(`/api/comments/${id}/replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, author: 'user' }),
      })
      return res.json() as Promise<ReviewComment>
    },
    onSuccess: (updated) => patchComments((prev) => prev.map((c) => (c.id === updated.id ? updated : c))),
  })

  const addComment = useCallback(
    (comment: NewComment) => {
      addMutation.mutate(comment)
    },
    [addMutation],
  )

  const dismissAddError = useCallback(() => setAddError(null), [])

  const removeComment = useCallback(
    (id: string) => {
      removeMutation.mutate(id)
    },
    [removeMutation],
  )

  const editComment = useCallback(
    (id: string, body: string) => {
      editMutation.mutate({ id, body })
    },
    [editMutation],
  )

  const replyToComment = useCallback(
    (id: string, body: string) => {
      replyMutation.mutate({ id, body })
    },
    [replyMutation],
  )

  const resolveComment = useCallback(
    (id: string) => {
      editMutation.mutate({ id, status: 'resolved' })
    },
    [editMutation],
  )

  const formatAllComments = useCallback((): string => formatComments(comments), [comments])

  const getAnnotationsForFile = useCallback(
    (filePath: string): DiffLineAnnotation<ReviewComment>[] => {
      return comments
        .filter((c) => c.filePath === filePath)
        .map((c) => ({
          side: c.side,
          lineNumber: c.lineNumber,
          metadata: c,
        }))
    },
    [comments],
  )

  const copyAllComments = useCallback(async () => {
    const text = formatAllComments()
    await navigator.clipboard.writeText(text)
  }, [formatAllComments])

  return {
    comments,
    addError,
    dismissAddError,
    addComment,
    removeComment,
    editComment,
    replyToComment,
    resolveComment,
    getAnnotationsForFile,
    formatAllComments,
    copyAllComments,
  }
}
