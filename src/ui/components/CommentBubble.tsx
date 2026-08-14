import { useState, useEffect, useRef } from 'react'
import { UserCircle, CheckCircle2, Bot, Reply } from 'lucide-react'
import type { ReviewComment } from '../../types'
import { timeAgo, lineLabel } from '../utils'

interface CommentBubbleProps {
  comment: ReviewComment
  onDelete: (id: string) => void
  onReply: (id: string, body: string) => void
}

export function CommentBubble({ comment, onDelete, onReply }: CommentBubbleProps) {
  const [, setTick] = useState(0)
  const [replying, setReplying] = useState(false)
  const [draft, setDraft] = useState('')
  const threadRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isResolved = comment.status === 'resolved'
  const replies = comment.replies ?? []

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30000)
    return () => clearInterval(timer)
  }, [])

  // A long thread is scrolled to its foot, where the conversation is: its box
  // has a fixed height, so the newest reply would otherwise sit out of sight.
  // The bubble hangs inside the diff component, which lays its annotations out
  // after this commit — measured now, the thread still has no height, so the
  // scroll waits for the frame that has one.
  useEffect(() => {
    const thread = threadRef.current
    if (!thread) return
    const frame = requestAnimationFrame(() => {
      thread.scrollTop = thread.scrollHeight
    })
    return () => cancelAnimationFrame(frame)
  }, [replies.length])

  useEffect(() => {
    if (replying) textareaRef.current?.focus()
  }, [replying])

  const closeReply = () => {
    setReplying(false)
    setDraft('')
  }

  const submitReply = () => {
    const trimmed = draft.trim()
    if (!trimmed) return
    onReply(comment.id, trimmed)
    closeReply()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      submitReply()
    }
    if (e.key === 'Escape') {
      closeReply()
    }
  }

  return (
    <div className={`comment-bubble ${isResolved ? 'comment-resolved' : ''}`} id={`comment-${comment.id}`}>
      <div className="comment-bubble-header">
        <UserCircle size={18} className="comment-bubble-avatar" />
        <span className="comment-bubble-lines">{lineLabel(comment.startLineNumber, comment.lineNumber)}</span>
        <span className="comment-bubble-time">{timeAgo(comment.createdAt)}</span>
        {isResolved && (
          <span className="comment-bubble-resolved">
            <CheckCircle2 size={14} />
            Resolved
          </span>
        )}
        {!isResolved && (
          <button
            className="comment-bubble-delete"
            onClick={() => onDelete(comment.id)}
            title="Delete comment"
          >
            &times;
          </button>
        )}
      </div>
      <div className="comment-bubble-body">{comment.body}</div>
      {replies.length > 0 && (
        <div className="comment-replies" ref={threadRef}>
          {replies.map((reply) => {
            const fromUser = reply.author === 'user'
            return (
              <div key={reply.id} className={`comment-reply ${fromUser ? 'comment-reply-user' : ''}`}>
                <div className="comment-reply-header">
                  {fromUser ? (
                    <UserCircle size={16} className="comment-reply-avatar comment-reply-avatar-user" />
                  ) : (
                    <Bot size={16} className="comment-reply-avatar" />
                  )}
                  <span className="comment-reply-author">{fromUser ? 'You' : 'Agent'}</span>
                  <span className="comment-bubble-time">{timeAgo(reply.createdAt)}</span>
                </div>
                <div className="comment-reply-body">{reply.body}</div>
              </div>
            )
          })}
        </div>
      )}
      {!isResolved &&
        (replying ? (
          <div className="comment-reply-form">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Reply…"
              rows={2}
            />
            <div className="comment-form-actions">
              <button className="btn btn-secondary" onClick={closeReply}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={submitReply} disabled={!draft.trim()}>
                Reply
              </button>
            </div>
          </div>
        ) : (
          <button className="comment-reply-button" onClick={() => setReplying(true)}>
            <Reply size={13} />
            Reply
          </button>
        ))}
    </div>
  )
}
