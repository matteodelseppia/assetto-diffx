import type { AnnotationSide, SelectedLineRange } from '@pierre/diffs'
import type { ReviewComment } from '../types'

/** The span of lines a comment being written covers. */
export interface CommentTarget {
  side: AnnotationSide
  startLine: number
  endLine: number
}

/**
 * The line range a drag produced, normalised for commenting: ends ordered, and
 * a range dragged across both columns of a split diff — which has no single
 * side to comment on — collapsed to the line the drag ended on.
 */
export function commentTargetFromRange(range: SelectedLineRange): CommentTarget {
  const side = range.side ?? 'additions'
  const endSide = range.endSide ?? side
  if (side !== endSide) {
    return { side: endSide, startLine: range.end, endLine: range.end }
  }
  return {
    side,
    startLine: Math.min(range.start, range.end),
    endLine: Math.max(range.start, range.end),
  }
}

/** A span of lines named for the reader: `Line 12` or `Lines 12–16`. */
export function lineLabel(startLine: number, endLine: number): string {
  return startLine === endLine ? `Line ${startLine}` : `Lines ${startLine}–${endLine}`
}

/** A comment's lines as `12` for a single line and `12-16` for a range. */
export function lineRange(comment: ReviewComment): string {
  return comment.startLineNumber === comment.lineNumber
    ? `${comment.lineNumber}`
    : `${comment.startLineNumber}-${comment.lineNumber}`
}

/**
 * The whole review as the markup a coding agent is handed. Each comment quotes
 * every line it covers, in diff notation, so the agent can locate the code.
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
      const attribute =
        comment.startLineNumber === comment.lineNumber
          ? `line="${comment.lineNumber}"`
          : `lines="${lineRange(comment)}"`
      lines.push(`<comment ${attribute}>`)
      const prefix = comment.side === 'additions' ? '+' : '-'
      lines.push(`<code>${comment.lineContents.map((line) => `${prefix} ${line}`).join('\n')}</code>`)
      lines.push(comment.body)
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

export function fileName(filePath: string): string {
  const parts = filePath.split('/')
  return parts[parts.length - 1]
}
