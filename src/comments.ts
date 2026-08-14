import type { ReviewComment, CommentReply } from './types.js'

/**
 * Whether a thread is waiting on the agent — its most recent message came from
 * the reviewer, so nobody has answered it yet. This is derived from the thread
 * itself rather than tracked in a queue: an answer makes the thread drop out on
 * its own, nothing is lost if the agent restarts mid-work, and a thread that
 * was never answered keeps showing up until it is.
 *
 * A resolved thread is settled and never waits, unless the reviewer has replied
 * to it since — that reply is a new request.
 */
export function isAwaitingAgent(comment: ReviewComment): boolean {
  const last = comment.replies[comment.replies.length - 1]
  if (!last) return comment.status === 'open'
  return last.author === 'user'
}

export function awaitingAgent(comments: ReviewComment[]): ReviewComment[] {
  return comments.filter(isAwaitingAgent)
}

/**
 * A version counter over the comment store that a request can wait on, so the
 * agent learns about a new comment the moment it is posted instead of polling
 * for one. Every mutation bumps the version and wakes every waiter.
 */
export class CommentWatch {
  private version = 0
  private waiters = new Set<() => void>()

  get currentVersion(): number {
    return this.version
  }

  bump(): void {
    this.version++
    const waiting = [...this.waiters]
    this.waiters.clear()
    for (const wake of waiting) wake()
  }

  /**
   * Resolves once the version has moved past `knownVersion`, or after
   * `timeoutMs`. Comparing against a version the caller read *before* it looked
   * at the comments is what keeps a mutation that lands in between from being
   * slept through.
   */
  waitForChange(knownVersion: number, timeoutMs: number): Promise<void> {
    if (this.version !== knownVersion) return Promise.resolve()
    return new Promise((resolve) => {
      const wake = () => {
        clearTimeout(timer)
        this.waiters.delete(wake)
        resolve()
      }
      const timer = setTimeout(wake, timeoutMs)
      // A pending long poll must not be what keeps the process alive.
      timer.unref?.()
      this.waiters.add(wake)
    })
  }
}

export interface CommentStore {
  getAll(): Promise<ReviewComment[]>
  add(comment: ReviewComment): Promise<ReviewComment>
  update(id: string, fields: { body?: string; status?: ReviewComment['status'] }): Promise<ReviewComment | null>
  remove(id: string): Promise<boolean>
  addReply(commentId: string, reply: CommentReply): Promise<ReviewComment | null>
}

export class InMemoryCommentStore implements CommentStore {
  private comments: ReviewComment[] = []

  async getAll(): Promise<ReviewComment[]> {
    return this.comments
  }

  async add(comment: ReviewComment): Promise<ReviewComment> {
    this.comments.push(comment)
    return comment
  }

  async update(id: string, fields: { body?: string; status?: ReviewComment['status'] }): Promise<ReviewComment | null> {
    const comment = this.comments.find((c) => c.id === id)
    if (!comment) return null
    if (fields.body !== undefined) comment.body = fields.body
    if (fields.status !== undefined) comment.status = fields.status
    return comment
  }

  async remove(id: string): Promise<boolean> {
    const index = this.comments.findIndex((c) => c.id === id)
    if (index === -1) return false
    this.comments.splice(index, 1)
    return true
  }

  async addReply(commentId: string, reply: CommentReply): Promise<ReviewComment | null> {
    const comment = this.comments.find((c) => c.id === commentId)
    if (!comment) return null
    comment.replies.push(reply)
    return comment
  }
}
