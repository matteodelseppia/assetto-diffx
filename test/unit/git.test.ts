import { describe, it, expect } from 'vitest'
import { isImageFile, getBlobContent } from '../../src/git.js'

describe('isImageFile', () => {
  it('recognises image extensions', () => {
    for (const path of ['a.png', 'a.jpg', 'a.jpeg', 'a.gif', 'a.webp', 'a.bmp', 'a.svg', 'a.ico', 'a.avif']) {
      expect(isImageFile(path)).toBe(true)
    }
  })

  it('is case insensitive', () => {
    expect(isImageFile('logo.PNG')).toBe(true)
  })

  it('rejects non-image extensions', () => {
    expect(isImageFile('src/index.ts')).toBe(false)
    expect(isImageFile('README.md')).toBe(false)
  })

  it('rejects files without an extension', () => {
    expect(isImageFile('Makefile')).toBe(false)
  })
})

describe('getBlobContent', () => {
  it('rejects oids that are not hex object ids', () => {
    expect(getBlobContent('HEAD')).toBeNull()
    expect(getBlobContent('../../etc/passwd')).toBeNull()
    expect(getBlobContent('')).toBeNull()
  })

  it('rejects the all-zero oid', () => {
    expect(getBlobContent('0000000')).toBeNull()
  })
})
