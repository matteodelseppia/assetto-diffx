import { useState, useEffect } from 'react'
import { rangeParams, type CommitRange } from './useCommits'

export interface BinaryFileInfo {
  path: string
  type: 'added' | 'deleted' | 'changed' | 'untracked'
}

interface DiffData {
  patch: string
  repoName: string
  branch: string
  customMode: boolean
  rangeMode: boolean
  binaryFiles: BinaryFileInfo[]
  tabSizeMap: Record<string, number>
  untrackedFiles: string[]
}

export interface DiffOptions {
  staged: boolean
  untracked: boolean
}

export function useDiff(options: DiffOptions, range: CommitRange) {
  const [data, setData] = useState<DiffData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { base, head } = range

  useEffect(() => {
    setLoading(true)
    setError(null)

    const params = new URLSearchParams({
      staged: String(options.staged),
      untracked: String(options.untracked),
      ...rangeParams({ base, head }),
    })

    // Switching range or toggling an option while a request is in flight leaves
    // overlapping requests that can resolve out of order. Abort the superseded
    // one so its response — or its failure — never overwrites the selection the
    // reviewer is actually looking at.
    const controller = new AbortController()

    fetch(`/api/diff?${params}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((json) => setData(json))
      .catch((err) => {
        if (controller.signal.aborted) return
        setError(err.message)
      })
      .finally(() => {
        // The newer request owns the loading state from here on.
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [options.staged, options.untracked, base, head])

  return {
    patch: data?.patch ?? null,
    repoName: data?.repoName ?? '',
    branch: data?.branch ?? '',
    customMode: data?.customMode ?? false,
    rangeMode: data?.rangeMode ?? false,
    binaryFiles: data?.binaryFiles ?? [],
    tabSizeMap: data?.tabSizeMap ?? {},
    untrackedFiles: data?.untrackedFiles ?? [],
    loading,
    error,
  }
}
