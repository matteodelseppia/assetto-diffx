import type { FileDiffMetadata } from '@pierre/diffs'

/** One rendered diff, and the DOM id of the card that shows it. */
export interface DiffEntry {
  file: FileDiffMetadata
  domId: string
}

/**
 * Identity of a single diff entry. A path alone is not enough: when staged and
 * unstaged changes are shown together the same file legitimately appears twice
 * (HEAD→index and index→worktree), and the two entries differ only by their
 * blob ids.
 */
export function entryKey(file: FileDiffMetadata): string {
  return `${file.name}\0${file.prevObjectId ?? ''}\0${file.newObjectId ?? ''}`
}

/**
 * A DOM id per entry, keyed by {@link entryKey}. The first entry for a path
 * keeps the bare `file-<path>` id so anything that can only resolve a path —
 * the comment tracker's fallback jump, since comments are anchored to a path —
 * still finds a card; further entries for that path are numbered.
 */
export function buildEntryIds(files: FileDiffMetadata[]): Map<string, string> {
  const ids = new Map<string, string>()
  const countByPath = new Map<string, number>()
  for (const file of files) {
    const key = entryKey(file)
    if (ids.has(key)) continue
    const occurrence = (countByPath.get(file.name) ?? 0) + 1
    countByPath.set(file.name, occurrence)
    ids.set(key, occurrence === 1 ? `file-${file.name}` : `file-${file.name}-${occurrence}`)
  }
  return ids
}

export interface TreeNode {
  name: string
  path: string
  isDir: boolean
  children: TreeNode[]
  file?: FileDiffMetadata
  /** Card to scroll to. Set on leaves only. */
  domId?: string
}

export function buildTree(entries: DiffEntry[]): TreeNode[] {
  const root: TreeNode[] = []

  for (const entry of entries) {
    const parts = entry.file.name.split('/')
    let current = root

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]
      const path = parts.slice(0, i + 1).join('/')
      const isDir = i < parts.length - 1

      // Directories merge by name, but two leaves only merge when they are the
      // same diff entry — a file changed both staged and unstaged has two, and
      // dropping either hides half of the change from the sidebar.
      let existing = current.find(
        (n) => n.name === name && n.isDir === isDir && (isDir || n.domId === entry.domId),
      )
      if (!existing) {
        existing = { name, path, isDir, children: [] }
        if (!isDir) {
          existing.file = entry.file
          existing.domId = entry.domId
        }
        current.push(existing)
      }
      current = existing.children
    }
  }

  function sortNodes(nodes: TreeNode[]) {
    nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const node of nodes) {
      if (node.isDir) sortNodes(node.children)
    }
  }
  sortNodes(root)

  return root
}
