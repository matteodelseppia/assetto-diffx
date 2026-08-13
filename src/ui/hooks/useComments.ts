import { useCallback, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { DiffLineAnnotation } from '@pierre/diffs'
import type { ReviewComment } from '../../types'
import { formatComments } from '../utils'

const COMMENTS_KEY = ['comments']

/** A comment as the reviewer wrote it, before the server assigns it an id. */
export type NewComment = Pick<
  ReviewComment,
  'filePath' | 'side' | 'startLineNumber' | 'lineNumber' | 'lineContents' | 'body'
>

async function fetchComments(): Promise<ReviewComment[]> {
  const res = await fetch('/api/comments')
  return res.json()
}

export function useComments() {
  const queryClient = useQueryClient()
  const [addError, setAddError] = useState<string | null>(null)
  const { data: comments = [] } = useQuery({ queryKey: COMMENTS_KEY, queryFn: fetchComments, refetchInterval: 3000 })

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
      queryClient.setQueryData<ReviewComment[]>(COMMENTS_KEY, (prev = []) => [...prev, comment])
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
    onSuccess: (id) => {
      queryClient.setQueryData<ReviewComment[]>(COMMENTS_KEY, (prev = []) => prev.filter((c) => c.id !== id))
    },
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
    onSuccess: (updated) => {
      queryClient.setQueryData<ReviewComment[]>(COMMENTS_KEY, (prev = []) =>
        prev.map((c) => (c.id === updated.id ? updated : c)),
      )
    },
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
    resolveComment,
    getAnnotationsForFile,
    formatAllComments,
    copyAllComments,
  }
}
