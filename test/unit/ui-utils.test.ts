import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  timeAgo,
  truncate,
  fileName,
  lineRange,
  lineLabel,
  formatComments,
  commentTargetFromRange,
  isCommentAnchored,
  settledFullDiffs,
} from '../../src/ui/utils.js'
import type { ReviewComment } from '../../src/types.js'
import type { FileDiffMetadata } from '@pierre/diffs'

function makeComment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: 'c1',
    filePath: 'src/index.ts',
    side: 'additions',
    lineNumber: 12,
    lineContent: 'const x = 1',
    body: 'nit: name this better',
    status: 'open',
    createdAt: 1_700_000_000_000,
    replies: [],
    ...overrides,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

/** Evaluates `timeAgo` for a timestamp `msAgo` milliseconds in the past. */
function at(msAgo: number): string {
  const now = new Date('2026-01-01T00:00:00Z')
  vi.useFakeTimers()
  vi.setSystemTime(now)
  return timeAgo(now.getTime() - msAgo)
}

describe('timeAgo', () => {
  it('reports very recent timestamps as "just now"', () => {
    expect(at(0)).toBe('just now')
    expect(at(4_000)).toBe('just now')
  })

  it('reports seconds, minutes, hours and days', () => {
    expect(at(30_000)).toBe('30s ago')
    expect(at(5 * 60_000)).toBe('5m ago')
    expect(at(3 * 3_600_000)).toBe('3h ago')
    expect(at(2 * 86_400_000)).toBe('2d ago')
  })

  it('switches unit exactly at the boundaries', () => {
    expect(at(60_000)).toBe('1m ago')
    expect(at(3_600_000)).toBe('1h ago')
    expect(at(86_400_000)).toBe('1d ago')
  })
})

describe('truncate', () => {
  it('leaves short text untouched', () => {
    expect(truncate('hello', 10)).toBe('hello')
  })

  it('keeps only the first line', () => {
    expect(truncate('first\nsecond', 100)).toBe('first')
  })

  it('adds an ellipsis when over the limit', () => {
    expect(truncate('abcdefghij', 5)).toBe('abcde…')
  })

  it('does not truncate at exactly the limit', () => {
    expect(truncate('abcde', 5)).toBe('abcde')
  })
})

describe('fileName', () => {
  it('returns the last path segment', () => {
    expect(fileName('src/ui/utils.ts')).toBe('utils.ts')
  })

  it('returns the input when there is no directory', () => {
    expect(fileName('README.md')).toBe('README.md')
  })
})

describe('lineRange', () => {
  it('reports the comment line as one number', () => {
    expect(lineRange(makeComment())).toBe('12')
  })
})

describe('formatComments', () => {
  it('returns nothing for an empty review', () => {
    expect(formatComments([])).toBe('')
  })

  it('quotes a single commented line with its diff marker', () => {
    expect(formatComments([makeComment()])).toBe(
      [
        '<code-review-comments>',
        '<file path="src/index.ts">',
        '<comment line="12">',
        '<code>+ const x = 1</code>',
        'nit: name this better',
        '</comment>',
        '</file>',
        '</code-review-comments>',
      ].join('\n'),
    )
  })

  it('carries the thread, attributing each reply', () => {
    const text = formatComments([
      makeComment({
        replies: [
          { id: 'r1', body: 'renamed it', createdAt: 1, author: 'agent' },
          { id: 'r2', body: 'the other one too, please', createdAt: 2, author: 'user' },
        ],
      }),
    ])
    expect(text).toContain('<reply author="agent">\nrenamed it\n</reply>')
    expect(text).toContain('<reply author="user">\nthe other one too, please\n</reply>')
    expect(text.indexOf('renamed it')).toBeLessThan(text.indexOf('the other one too'))
  })

  it('marks deleted lines with a minus', () => {
    const text = formatComments([makeComment({ side: 'deletions' })])
    expect(text).toContain('<code>- const x = 1</code>')
  })

  it('groups comments under the file they belong to', () => {
    const text = formatComments([
      makeComment({ id: 'a' }),
      makeComment({ id: 'b', filePath: 'src/other.ts' }),
      makeComment({ id: 'c' }),
    ])
    expect(text.match(/<file path="src\/index.ts">/g)).toHaveLength(1)
    expect(text.match(/<file path=/g)).toHaveLength(2)
  })
})

describe('commentTargetFromRange', () => {
  it('keeps a single-line selection as one line', () => {
    expect(commentTargetFromRange({ start: 7, end: 7, side: 'additions' })).toEqual({
      side: 'additions',
      line: 7,
    })
  })

  it('anchors to the line a drag ended on', () => {
    expect(commentTargetFromRange({ start: 4, end: 9, side: 'additions' })).toEqual({
      side: 'additions',
      line: 9,
    })
  })

  it('defaults to the additions side when the range carries none', () => {
    expect(commentTargetFromRange({ start: 2, end: 3 })).toEqual({
      side: 'additions',
      line: 3,
    })
  })

  it('anchors to the side and line a drag ended on across both sides of a split diff', () => {
    expect(
      commentTargetFromRange({ start: 4, end: 9, side: 'deletions', endSide: 'additions' }),
    ).toEqual({ side: 'additions', line: 9 })
  })
})

describe('lineLabel', () => {
  it('names a single line', () => {
    expect(lineLabel(12)).toBe('Line 12')
  })
})

describe('settledFullDiffs', () => {
  it('adopts the latest map once nothing is being interacted with', () => {
    const committed = new Map([['a', 1]])
    const latest = new Map([['a', 1], ['b', 2]])
    expect(settledFullDiffs(committed, latest, false)).toBe(latest)
  })

  it('holds the previously committed map while a selection or comment form is active', () => {
    const committed = new Map([['a', 1]])
    const latest = new Map([['a', 1], ['b', 2]])
    expect(settledFullDiffs(committed, latest, true)).toBe(committed)
  })

  it('picks up everything that was held as soon as interacting turns off', () => {
    const committed = new Map([['a', 1]])
    const latest = new Map([['a', 1], ['b', 2], ['c', 3]])
    // Simulates the caller's effect: held while dragging, then re-evaluated
    // once the drag ends and `interacting` flips to false.
    const heldDuringDrag = settledFullDiffs(committed, latest, true)
    expect(settledFullDiffs(heldDuringDrag, latest, false)).toBe(latest)
  })
})

function makeFile(overrides: Partial<FileDiffMetadata> = {}): FileDiffMetadata {
  return {
    name: 'src/index.ts',
    type: 'change',
    hunks: [],
    splitLineCount: 0,
    unifiedLineCount: 0,
    isPartial: true,
    deletionLines: [],
    additionLines: [],
    ...overrides,
  }
}

describe('isCommentAnchored', () => {
  it('is anchored when its file and content still appear in the current diff', () => {
    const comment = makeComment({ filePath: 'src/index.ts', side: 'additions', lineContent: 'const x = 1' })
    const files = [makeFile({ name: 'src/index.ts', additionLines: ['const x = 1', 'const y = 2'] })]
    expect(isCommentAnchored(comment, files)).toBe(true)
  })

  it('is orphaned once its commented code is gone from the current diff (refactored away)', () => {
    const comment = makeComment({ filePath: 'src/index.ts', side: 'additions', lineContent: 'const x = 1' })
    const files = [makeFile({ name: 'src/index.ts', additionLines: ['const renamed = 1'] })]
    expect(isCommentAnchored(comment, files)).toBe(false)
  })

  it('is orphaned when the file it was on no longer appears in the diff at all', () => {
    const comment = makeComment({ filePath: 'src/index.ts', side: 'additions', lineContent: 'const x = 1' })
    expect(isCommentAnchored(comment, [])).toBe(false)
  })

  it('checks deletions against deletionLines and additions against additionLines', () => {
    const comment = makeComment({ filePath: 'src/index.ts', side: 'deletions', lineContent: 'const old = 1' })
    const files = [makeFile({ name: 'src/index.ts', deletionLines: ['const old = 1'], additionLines: [] })]
    expect(isCommentAnchored(comment, files)).toBe(true)
  })

  it('ignores surrounding whitespace, matching the server-side worktree check', () => {
    const comment = makeComment({ filePath: 'src/index.ts', side: 'additions', lineContent: '  const x = 1  ' })
    const files = [makeFile({ name: 'src/index.ts', additionLines: ['const x = 1'] })]
    expect(isCommentAnchored(comment, files)).toBe(true)
  })
})
