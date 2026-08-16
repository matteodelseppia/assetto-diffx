import { describe, it, expect } from 'vitest'
import { parseCommentInput, parseReplyInput } from '../../src/server.js'

const valid = {
  filePath: 'src/a.ts',
  side: 'additions',
  lineNumber: 2,
  lineContent: 'const b = 2',
  body: 'why?',
}

function error(payload: unknown): string {
  const result = parseCommentInput(payload)
  expect(result, JSON.stringify(payload)).toHaveProperty('error')
  return (result as { error: string }).error
}

describe('parseCommentInput', () => {
  it('accepts a well-formed comment', () => {
    const result = parseCommentInput(valid)
    expect(result).toEqual({
      input: {
        filePath: 'src/a.ts',
        side: 'additions',
        lineNumber: 2,
        lineContent: 'const b = 2',
        body: 'why?',
      },
    })
  })

  it('defaults missing line content to none', () => {
    const result = parseCommentInput({ ...valid, lineContent: undefined })
    expect(result).toMatchObject({ input: { lineContent: '' } })
  })

  it('rejects a missing or unusable line number', () => {
    expect(error({ ...valid, lineNumber: undefined })).toMatch(/lineNumber/)
    expect(error({ ...valid, lineNumber: 'three' })).toMatch(/lineNumber/)
    expect(error({ ...valid, lineNumber: 1.5 })).toMatch(/lineNumber/)
    expect(error({ ...valid, lineNumber: 0 })).toMatch(/lineNumber/)
  })

  it('rejects a missing or empty file path', () => {
    expect(error({ ...valid, filePath: undefined })).toMatch(/filePath/)
    expect(error({ ...valid, filePath: '   ' })).toMatch(/filePath/)
    expect(error({ ...valid, filePath: 42 })).toMatch(/filePath/)
  })

  it('rejects a side that is not one of the two diff sides', () => {
    expect(error({ ...valid, side: undefined })).toMatch(/side/)
    expect(error({ ...valid, side: 'context' })).toMatch(/side/)
  })

  it('rejects an empty comment', () => {
    expect(error({ ...valid, body: undefined })).toMatch(/body/)
    expect(error({ ...valid, body: '  ' })).toMatch(/body/)
  })

  it('rejects line content that is not a string', () => {
    expect(error({ ...valid, lineContent: 1 })).toMatch(/lineContent/)
    expect(error({ ...valid, lineContent: ['const a = 1'] })).toMatch(/lineContent/)
  })

  it('rejects a payload that is not an object', () => {
    expect(error(null)).toMatch(/JSON object/)
    expect(error('a comment')).toMatch(/JSON object/)
  })
})

describe('parseReplyInput', () => {
  function replyError(payload: unknown): string {
    const result = parseReplyInput(payload)
    expect(result, JSON.stringify(payload)).toHaveProperty('error')
    return (result as { error: string }).error
  }

  it('reads the reviewer\'s own reply', () => {
    expect(parseReplyInput({ body: 'still unclear', author: 'user' })).toEqual({
      input: { body: 'still unclear', author: 'user' },
    })
  })

  it('attributes a reply with no author to the agent', () => {
    expect(parseReplyInput({ body: 'done' })).toEqual({ input: { body: 'done', author: 'agent' } })
  })

  it('rejects an empty reply', () => {
    expect(replyError({ body: '   ' })).toMatch(/body/)
    expect(replyError({ author: 'user' })).toMatch(/body/)
  })

  it('rejects an unknown author', () => {
    expect(replyError({ body: 'hi', author: 'reviewer' })).toMatch(/author/)
  })

  it('rejects a payload that is not an object', () => {
    expect(replyError(null)).toMatch(/JSON object/)
  })
})
