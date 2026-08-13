import { describe, it, expect, vi, afterEach } from 'vitest'
import { timeAgo, truncate, fileName, lineRange, lineLabel, formatComments, commentTargetFromRange } from '../../src/ui/utils.js'
import type { ReviewComment } from '../../src/types.js'

function makeComment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: 'c1',
    filePath: 'src/index.ts',
    side: 'additions',
    startLineNumber: 12,
    lineNumber: 12,
    lineContents: ['const x = 1'],
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
  it('reports a single line as one number', () => {
    expect(lineRange(makeComment())).toBe('12')
  })

  it('reports a range as its two ends', () => {
    expect(lineRange(makeComment({ startLineNumber: 12, lineNumber: 16 }))).toBe('12-16')
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

  it('quotes every line of a range comment', () => {
    const text = formatComments([
      makeComment({
        startLineNumber: 12,
        lineNumber: 14,
        lineContents: ['const x = 1', 'const y = 2', 'const z = 3'],
      }),
    ])
    expect(text).toContain('<comment lines="12-14">')
    expect(text).toContain('<code>+ const x = 1\n+ const y = 2\n+ const z = 3</code>')
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
      startLine: 7,
      endLine: 7,
    })
  })

  it('keeps a downward drag in order', () => {
    expect(commentTargetFromRange({ start: 4, end: 9, side: 'additions' })).toEqual({
      side: 'additions',
      startLine: 4,
      endLine: 9,
    })
  })

  it('orders the ends of an upward drag', () => {
    expect(commentTargetFromRange({ start: 9, end: 4, side: 'deletions' })).toEqual({
      side: 'deletions',
      startLine: 4,
      endLine: 9,
    })
  })

  it('defaults to the additions side when the range carries none', () => {
    expect(commentTargetFromRange({ start: 2, end: 3 })).toEqual({
      side: 'additions',
      startLine: 2,
      endLine: 3,
    })
  })

  it('collapses a range dragged across both sides of a split diff', () => {
    expect(
      commentTargetFromRange({ start: 4, end: 9, side: 'deletions', endSide: 'additions' }),
    ).toEqual({ side: 'additions', startLine: 9, endLine: 9 })
  })
})

describe('lineLabel', () => {
  it('names a single line', () => {
    expect(lineLabel(12, 12)).toBe('Line 12')
  })

  it('names a range by its ends', () => {
    expect(lineLabel(12, 16)).toBe('Lines 12–16')
  })
})
