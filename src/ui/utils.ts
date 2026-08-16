import type { AnnotationSide, FileDiffMetadata, SelectedLineRange } from '@pierre/diffs'
import type { ReviewComment } from '../types'

/** The line a comment being written covers. */
export interface CommentTarget {
  side: AnnotationSide
  line: number
}

/**
 * The line a drag produced, normalised for commenting: a drag that ended on a
 * different column than it started — which has no single side to comment on
 * — is anchored to the side and line it ended on.
 */
export function commentTargetFromRange(range: SelectedLineRange): CommentTarget {
  return { side: range.endSide ?? range.side ?? 'additions', line: range.end }
}

/** A single line named for the reader: `Line 12`. */
export function lineLabel(line: number): string {
  return `Line ${line}`
}

/** A comment's line as `12`. */
export function lineRange(comment: ReviewComment): string {
  return `${comment.lineNumber}`
}

/**
 * The whole review as the markup a coding agent is handed. Each comment quotes
 * the line it covers, in diff notation, so the agent can locate the code.
 */
export function formatComments(comments: ReviewComment[]): string {
  if (comments.length === 0) return ''

  const grouped = new Map<string, ReviewComment[]>()
  for (const comment of comments) {
    const list = grouped.get(comment.filePath) ?? []
    list.push(comment)
    grouped.set(comment.filePath, list)
  }

  const lines: string[] = ['<code-review-comments>']
  for (const [filePath, fileComments] of grouped) {
    lines.push(`<file path="${filePath}">`)
    for (const comment of fileComments) {
      lines.push(`<comment line="${comment.lineNumber}">`)
      const prefix = comment.side === 'additions' ? '+' : '-'
      lines.push(`<code>${prefix} ${comment.lineContent}</code>`)
      lines.push(comment.body)
      // The thread is part of the request: the agent needs what has already
      // been answered, and what the reviewer replied to it.
      for (const reply of comment.replies ?? []) {
        lines.push(`<reply author="${reply.author === 'user' ? 'user' : 'agent'}">`)
        lines.push(reply.body)
        lines.push('</reply>')
      }
      lines.push('</comment>')
    }
    lines.push('</file>')
  }
  lines.push('</code-review-comments>')

  return lines.join('\n')
}

export function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function truncate(text: string, maxLen: number): string {
  const firstLine = text.split('\n')[0]
  if (firstLine.length <= maxLen) return firstLine
  return firstLine.slice(0, maxLen) + '…'
}

/**
 * Whether a comment's code is still present in the current diff, so its
 * inline bubble has somewhere to render. A refactor can shift or delete the
 * lines a comment was anchored to; when that happens `lineNumber` keeps
 * pointing at whatever now occupies that spot, so anchoring is re-checked by
 * content rather than trusted at the stored line number. Mirrors the
 * whitespace-insensitive membership check the server runs at creation time
 * (`isLinePresentInWorktree`), so a comment that could be posted can also
 * still be found later.
 */
export function isCommentAnchored(comment: ReviewComment, files: FileDiffMetadata[]): boolean {
  const file = files.find((f) => f.name === comment.filePath)
  if (!file) return false
  const lines = comment.side === 'additions' ? file.additionLines : file.deletionLines
  const needle = comment.lineContent.trim()
  if (needle === '') return true
  return lines.some((line) => line.trim() === needle)
}

/**
 * Which full-diff upgrades are safe to hand to the diff viewer right now.
 * Applying one flips `file.isPartial`, which changes a FileDiffCard's key and
 * forces @pierre/diffs to remount that file's `<FileDiff>` — destroying any
 * gutter-drag selection or open comment form it (or, under the shared
 * Virtualizer, a neighboring card) was mid-interaction with. Holding the
 * previous map isn't a lost upgrade: the caller re-evaluates on every
 * `latest` change, so the moment `interacting` goes false the newest map is
 * adopted.
 */
export function settledFullDiffs<T>(
  committed: Map<string, T>,
  latest: Map<string, T>,
  interacting: boolean,
): Map<string, T> {
  return interacting ? committed : latest
}

export function fileName(filePath: string): string {
  const parts = filePath.split('/')
  return parts[parts.length - 1]
}
