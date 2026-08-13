import { describe, it, expect, vi, afterEach } from 'vitest'
import { timeAgo, truncate, fileName } from '../../src/ui/utils.js'

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
