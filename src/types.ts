export interface CommentReply {
  id: string
  body: string
  createdAt: number
  /** Who wrote the reply. Replies posted through the API default to the agent. */
  author: 'user' | 'agent'
}

export interface ReviewComment {
  id: string
  filePath: string
  side: 'deletions' | 'additions'
  /** The line the comment is anchored to in the diff. */
  lineNumber: number
  /** Content of the commented line. */
  lineContent: string
  body: string
  status: 'open' | 'resolved'
  createdAt: number
  replies: CommentReply[]
}

export interface CommitSummary {
  sha: string
  shortSha: string
  subject: string
  author: string
  date: string
}
