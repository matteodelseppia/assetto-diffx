import {
  MessageSquare,
  CheckCircle2,
  Reply,
  Circle,
  FileWarning,
} from 'lucide-react'
import type { FileDiffMetadata } from '@pierre/diffs'
import type { ReviewComment } from '../../types'
import { timeAgo, truncate, fileName, lineRange, isCommentAnchored } from '../utils'

interface CommentTrackerProps {
  comments: ReviewComment[]
  files: FileDiffMetadata[]
}

type CommentStatus = 'open' | 'replied' | 'resolved'

/**
 * Brings a comment into view. The plain `#comment-…` jump aligns it with the
 * top of the scroller, where the file's sticky header covers it, and does
 * nothing at all when the line it hangs from sits in a hunk that has not been
 * expanded — in that case the file itself is the closest we can get.
 */
function scrollToComment(comment: ReviewComment): void {
  const bubble = document.getElementById(`comment-${comment.id}`)
  if (bubble) {
    bubble.scrollIntoView({ block: 'center' })
    return
  }
  document.getElementById(`file-${comment.filePath}`)?.scrollIntoView({ block: 'start' })
}

/**
 * A thread counts as replied only while the agent had the last word: once the
 * reviewer answers back, the comment is waiting on the agent again and reads as
 * open.
 */
function getCommentStatus(comment: ReviewComment): CommentStatus {
  if (comment.status === 'resolved') return 'resolved'
  const last = comment.replies?.[comment.replies.length - 1]
  if (last && last.author !== 'user') return 'replied'
  return 'open'
}

function StatusBadge({ status }: { status: CommentStatus }) {
  switch (status) {
    case 'open':
      return (
        <span className="ct-status ct-status-open" title="Open">
          <Circle size={12} />
        </span>
      )
    case 'replied':
      return (
        <span className="ct-status ct-status-replied" title="Replied">
          <Reply size={12} />
        </span>
      )
    case 'resolved':
      return (
        <span className="ct-status ct-status-resolved" title="Resolved">
          <CheckCircle2 size={12} />
        </span>
      )
  }
}

export function CommentTracker({ comments, files }: CommentTrackerProps) {
  if (comments.length === 0) return null

  const sorted = [...comments].sort((a, b) => b.createdAt - a.createdAt)

  const openCount = sorted.filter((c) => getCommentStatus(c) === 'open').length
  const repliedCount = sorted.filter((c) => getCommentStatus(c) === 'replied').length
  const resolvedCount = sorted.filter((c) => getCommentStatus(c) === 'resolved').length

  return (
    <div className="ct">
      <div className="ct-header">
        <MessageSquare size={14} />
        <span className="ct-title">Comments</span>
        <span className="ct-counts">
          {openCount > 0 && <span className="ct-count ct-count-open">{openCount} open</span>}
          {repliedCount > 0 && <span className="ct-count ct-count-replied">{repliedCount} replied</span>}
          {resolvedCount > 0 && <span className="ct-count ct-count-resolved">{resolvedCount} resolved</span>}
        </span>
      </div>
      <ul className="ct-list">
        {sorted.map((comment) => {
          const status = getCommentStatus(comment)
          // A refactor can delete or rewrite the code a comment hangs from,
          // leaving nothing for its inline bubble to anchor to. When that
          // happens the comment still needs to be reviewable, so its original
          // snippet is shown right here instead of relying on the diff to
          // still contain it.
          const anchored = isCommentAnchored(comment, files)
          return (
            <li
              key={comment.id}
              className={`ct-item ${status === 'resolved' ? 'ct-item-resolved' : ''}`}
            >
              <a
                href={`#comment-${comment.id}`}
                className="ct-item-link"
                onClick={(e) => {
                  if (window.getSelection()?.toString()) return
                  e.preventDefault()
                  scrollToComment(comment)
                }}
              >
                <div className="ct-item-header">
                  <StatusBadge status={status} />
                  {!anchored && (
                    <span className="ct-item-orphan" title="This code has changed since the comment was posted — showing the original snippet">
                      <FileWarning size={12} />
                    </span>
                  )}
                  <span className="ct-item-file" title={comment.filePath}>
                    {fileName(comment.filePath)}:{lineRange(comment)}
                  </span>
                  <span className="ct-item-time">{timeAgo(comment.createdAt)}</span>
                </div>
                <div className="ct-item-body">{truncate(comment.body, 80)}</div>
                {!anchored && <pre className="ct-item-snippet">{comment.lineContent}</pre>}
              </a>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
