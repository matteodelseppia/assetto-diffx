import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { isSafePath } from '../../src/path.js'

const base = resolve('/tmp/assetto-diffx-base')

describe('isSafePath', () => {
  it('accepts paths inside the base directory', () => {
    expect(isSafePath('index.html', base)).toBe(true)
    expect(isSafePath('assets/app.js', base)).toBe(true)
    expect(isSafePath('a/b/c/d.css', base)).toBe(true)
  })

  it('accepts the base directory itself', () => {
    expect(isSafePath('', base)).toBe(true)
    expect(isSafePath('.', base)).toBe(true)
  })

  it('rejects parent directory traversal', () => {
    expect(isSafePath('../secret', base)).toBe(false)
    expect(isSafePath('assets/../../secret', base)).toBe(false)
  })

  it('rejects URL-encoded traversal', () => {
    expect(isSafePath('%2e%2e/secret', base)).toBe(false)
    expect(isSafePath('..%2fsecret', base)).toBe(false)
    expect(isSafePath('%2e%2e%2f%2e%2e%2fetc%2fpasswd', base)).toBe(false)
  })

  it('rejects backslash traversal', () => {
    expect(isSafePath('..\\secret', base)).toBe(false)
    expect(isSafePath('%5c..%5csecret', base)).toBe(false)
  })

  it('rejects absolute paths', () => {
    expect(isSafePath('/etc/passwd', base)).toBe(false)
  })

  it('rejects null bytes', () => {
    expect(isSafePath('index.html\0.png', base)).toBe(false)
  })

  it('does not reject a sibling directory sharing the base name prefix', () => {
    expect(isSafePath('index.html', base)).toBe(true)
    expect(isSafePath('../assetto-diffx-base-evil/index.html', base)).toBe(false)
  })

  it('treats malformed percent-encoding as a literal path', () => {
    expect(isSafePath('100%.css', base)).toBe(true)
  })
})
