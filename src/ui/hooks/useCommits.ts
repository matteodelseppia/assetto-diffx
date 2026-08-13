import { useQuery } from '@tanstack/react-query'
import type { CommitSummary } from '../../types'

/**
 * A diff range selected in the browser. `base` is empty in the default mode,
 * where the range comes from the CLI (custom diff args) or is the working tree
 * against HEAD. An empty `head` means "up to the working tree".
 */
export interface CommitRange {
  base: string
  head: string
}

export const DEFAULT_RANGE: CommitRange = { base: '', head: '' }

export function rangeParams(range: CommitRange): Record<string, string> {
  if (!range.base) return {}
  return range.head ? { base: range.base, head: range.head } : { base: range.base }
}

async function fetchCommits(): Promise<CommitSummary[]> {
  const res = await fetch('/api/commits')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = (await res.json()) as { commits: CommitSummary[] }
  return json.commits
}

export function useCommits() {
  const { data: commits = [], isLoading } = useQuery({
    queryKey: ['commits'],
    queryFn: fetchCommits,
    staleTime: 30_000,
  })
  return { commits, loading: isLoading }
}
