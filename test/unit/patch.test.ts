import { describe, it, expect } from 'vitest'
import { parseFilePaths, parseBinaryFiles, parseChunkPath, diffContainsFileVersion } from '../../src/server.js'

const textPatch = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,2 @@
-const a = 1
+const a = 2
 const b = 3
diff --git a/src/b.ts b/src/b.ts
index 3333333..4444444 100644
--- a/src/b.ts
+++ b/src/b.ts
@@ -1 +1 @@
-old
+new
`

const binaryPatch = `diff --git a/logo.png b/logo.png
index 5555555..6666666 100644
Binary files a/logo.png and b/logo.png differ
diff --git a/new.png b/new.png
new file mode 100644
index 0000000..7777777
Binary files /dev/null and b/new.png differ
diff --git a/gone.png b/gone.png
deleted file mode 100644
index 8888888..0000000
Binary files a/gone.png and /dev/null differ
`

// A directory literally named `a b` puts " b/" inside the path, which is also
// the separator of the `diff --git a/… b/…` line.
const ambiguousTextPatch = `diff --git a/src/a b/c.ts b/src/a b/c.ts
index aaaaaaa..bbbbbbb 100644
--- a/src/a b/c.ts
+++ b/src/a b/c.ts
@@ -1 +1 @@
-x
+y
`

const ambiguousBinaryPatch = `diff --git a/img a b/logo.png b/img a b/logo.png
index 5555555..6666666 100644
Binary files a/img a b/logo.png and b/img a b/logo.png differ
diff --git a/img a b/gone.png b/img a b/gone.png
deleted file mode 100644
index 8888888..0000000
Binary files a/img a b/gone.png and /dev/null differ
`

describe('parseFilePaths', () => {
  it('extracts every changed path', () => {
    expect(parseFilePaths(textPatch)).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('deduplicates repeated paths', () => {
    expect(parseFilePaths(textPatch + textPatch)).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('returns nothing for an empty patch', () => {
    expect(parseFilePaths('')).toEqual([])
  })

  it('keeps the whole path when it contains " b/"', () => {
    expect(parseFilePaths(ambiguousTextPatch)).toEqual(['src/a b/c.ts'])
  })
})

describe('parseBinaryFiles', () => {
  it('classifies changed, added and deleted binary files', () => {
    expect(parseBinaryFiles(binaryPatch)).toEqual([
      { path: 'logo.png', type: 'changed' },
      { path: 'new.png', type: 'added' },
      { path: 'gone.png', type: 'deleted' },
    ])
  })

  it('reports added files that are untracked as untracked', () => {
    expect(parseBinaryFiles(binaryPatch, new Set(['new.png']))).toContainEqual({
      path: 'new.png',
      type: 'untracked',
    })
  })

  it('ignores text-only patches', () => {
    expect(parseBinaryFiles(textPatch)).toEqual([])
  })

  it('reads a path containing " b/" off the diff --git line', () => {
    expect(parseBinaryFiles(ambiguousBinaryPatch)).toEqual([
      { path: 'img a b/logo.png', type: 'changed' },
      { path: 'img a b/gone.png', type: 'deleted' },
    ])
  })
})

describe('parseChunkPath', () => {
  const chunks = (patch: string) => patch.split(/^(?=diff --git )/m).filter(Boolean)

  it('prefers the +++ header over the ambiguous diff --git line', () => {
    expect(parseChunkPath(chunks(ambiguousTextPatch)[0])).toBe('src/a b/c.ts')
  })

  it('falls back to the --- header for a deletion', () => {
    const chunk = `diff --git a/src/a b/c.ts b/src/a b/c.ts
deleted file mode 100644
index aaaaaaa..0000000
--- a/src/a b/c.ts
+++ /dev/null
@@ -1 +0,0 @@
-x
`
    expect(parseChunkPath(chunk)).toBe('src/a b/c.ts')
  })

  it('reports the new path of a rename', () => {
    const chunk = `diff --git a/old.png b/new.png
similarity index 100%
rename from old.png
rename to new.png
`
    expect(parseChunkPath(chunk)).toBe('new.png')
  })

  it('reads the diff --git line when both sides are the same path', () => {
    expect(parseChunkPath(chunks(ambiguousBinaryPatch)[0])).toBe('img a b/logo.png')
  })

  it('returns nothing for a chunk it cannot resolve', () => {
    expect(parseChunkPath('diff --git a/old b/thing b/new b/thing\nindex 1..2 100644\n')).toBeNull()
    expect(parseChunkPath('not a chunk')).toBeNull()
  })
})

describe('diffContainsFileVersion', () => {
  it('matches a path with the oids from its index line', () => {
    expect(diffContainsFileVersion(textPatch, 'src/a.ts', '1111111', '2222222')).toBe(true)
    expect(diffContainsFileVersion(textPatch, 'src/b.ts', '3333333', '4444444')).toBe(true)
  })

  it('rejects oids that belong to a different file in the same patch', () => {
    expect(diffContainsFileVersion(textPatch, 'src/a.ts', '3333333', '4444444')).toBe(false)
  })

  it('rejects an unknown path', () => {
    expect(diffContainsFileVersion(textPatch, 'src/c.ts', '1111111', '2222222')).toBe(false)
  })

  it('rejects a stale new oid', () => {
    expect(diffContainsFileVersion(textPatch, 'src/a.ts', '1111111', 'deadbee')).toBe(false)
  })

  it('matches paths containing " b/" using the +++ header', () => {
    const patch = `diff --git a/src/a b/c.ts b/src/a b/c.ts
index aaaaaaa..bbbbbbb 100644
--- a/src/a b/c.ts
+++ b/src/a b/c.ts
@@ -1 +1 @@
-x
+y
`
    expect(diffContainsFileVersion(patch, 'src/a b/c.ts', 'aaaaaaa', 'bbbbbbb')).toBe(true)
  })
})
