import { describe, it, expect } from 'vitest'
import { parseRangeQuery } from '../../src/server.js'

const KNOWN = new Set(['aaaaaaa', 'bbbbbbb'])
const isCommit = (sha: string) => KNOWN.has(sha)

describe('parseRangeQuery', () => {
  it('returns null when no range was requested', () => {
    expect(parseRangeQuery(undefined, undefined, isCommit)).toBeNull()
    expect(parseRangeQuery('', '', isCommit)).toBeNull()
  })

  it('reads a base-only range, which ends at the working tree', () => {
    expect(parseRangeQuery('aaaaaaa', undefined, isCommit)).toEqual({ base: 'aaaaaaa' })
  })

  it('reads a two-ended range', () => {
    expect(parseRangeQuery('aaaaaaa', 'bbbbbbb', isCommit)).toEqual({ base: 'aaaaaaa', head: 'bbbbbbb' })
  })

  it('rejects a head without a base', () => {
    expect(parseRangeQuery(undefined, 'bbbbbbb', isCommit)).toBe('invalid')
  })

  it('rejects ends that are not commits in this repository', () => {
    expect(parseRangeQuery('ccccccc', undefined, isCommit)).toBe('invalid')
    expect(parseRangeQuery('aaaaaaa', 'ccccccc', isCommit)).toBe('invalid')
  })

  it('rejects revisions that are not object ids', () => {
    expect(parseRangeQuery('HEAD~1', undefined)).toBe('invalid')
    expect(parseRangeQuery('--output=/tmp/pwned', undefined)).toBe('invalid')
    expect(parseRangeQuery('main', undefined)).toBe('invalid')
  })
})
