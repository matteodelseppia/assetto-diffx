import { describe, it, expect } from 'vitest'
import type { FileDiffMetadata } from '@pierre/diffs'
import { buildEntryIds, buildTree, entryKey, type DiffEntry } from '../../src/ui/fileTree.js'

function file(name: string, prevObjectId = '1111111', newObjectId = '2222222'): FileDiffMetadata {
  return {
    name,
    type: 'change',
    hunks: [],
    splitLineCount: 0,
    unifiedLineCount: 0,
    isPartial: true,
    deletionLines: [],
    additionLines: [],
    prevObjectId,
    newObjectId,
  } as unknown as FileDiffMetadata
}

function entries(files: FileDiffMetadata[]): DiffEntry[] {
  const ids = buildEntryIds(files)
  return files.map((f) => ({ file: f, domId: ids.get(entryKey(f))! }))
}

/** The same path, changed in the index and again in the working tree. */
const stagedAndUnstaged = [
  file('src/a.ts', '1111111', '2222222'),
  file('src/a.ts', '2222222', '3333333'),
]

describe('buildEntryIds', () => {
  it('gives the only entry for a path the bare path id', () => {
    const ids = buildEntryIds([file('src/a.ts')])
    expect([...ids.values()]).toEqual(['file-src/a.ts'])
  })

  it('numbers further entries for the same path', () => {
    const ids = buildEntryIds(stagedAndUnstaged)
    expect([...ids.values()]).toEqual(['file-src/a.ts', 'file-src/a.ts-2'])
  })

  it('keeps paths that differ only by directory apart', () => {
    const ids = buildEntryIds([file('a/x.ts'), file('b/x.ts')])
    expect([...ids.values()]).toEqual(['file-a/x.ts', 'file-b/x.ts'])
  })
})

describe('buildTree', () => {
  it('nests files under their directories', () => {
    const [root] = buildTree(entries([file('src/nested/a.ts')]))
    expect(root.name).toBe('src')
    expect(root.isDir).toBe(true)
    expect(root.children[0].name).toBe('nested')
    expect(root.children[0].children[0].name).toBe('a.ts')
    expect(root.children[0].children[0].domId).toBe('file-src/nested/a.ts')
  })

  it('keeps both entries when a file is changed staged and unstaged', () => {
    const [src] = buildTree(entries(stagedAndUnstaged))
    expect(src.children).toHaveLength(2)
    expect(src.children.map((n) => n.domId)).toEqual(['file-src/a.ts', 'file-src/a.ts-2'])
    expect(src.children.map((n) => n.file?.newObjectId)).toEqual(['2222222', '3333333'])
  })

  it('still merges the directories those entries share', () => {
    const tree = buildTree(entries(stagedAndUnstaged))
    expect(tree).toHaveLength(1)
    expect(tree[0].name).toBe('src')
  })

  it('sorts directories before files, each alphabetically', () => {
    const tree = buildTree(entries([file('z.ts'), file('a.ts'), file('src/b.ts')]))
    expect(tree.map((n) => n.name)).toEqual(['src', 'a.ts', 'z.ts'])
  })
})
