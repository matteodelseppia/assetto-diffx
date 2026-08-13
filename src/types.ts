export interface CommentReply {
  id: string
  body: string
  createdAt: number
}

export interface ReviewComment {
  id: string
  filePath: string
  side: 'deletions' | 'additions'
  lineNumber: number
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
