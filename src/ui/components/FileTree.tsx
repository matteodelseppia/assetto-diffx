import { useState, useMemo } from 'react'
import {
  ChevronRight,
  Folder,
  FolderOpen,
  FilePlus,
  FileMinus,
  FileDiff,
  FileEdit,
  FileCheck,
  FileQuestion,
  MessageSquare,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'
import type { FileDiffMetadata } from '@pierre/diffs'
import { buildTree, type DiffEntry, type TreeNode } from '../fileTree'

interface FileTreeProps {
  entries: DiffEntry[]
  activeCard: string | null
  commentCounts: Record<string, number>
  viewedFiles: Set<string>
  untrackedFiles: Set<string>
  onFileClick: (domId: string) => void
  collapsed?: boolean
  onToggleCollapse?: () => void
}

function inferChangeType(file: FileDiffMetadata, untrackedFiles: Set<string>): string {
  if (untrackedFiles.has(file.name)) return 'untracked'
  // parsePatchFiles doesn't always set changeType, infer from object IDs
  if (file.prevName) return 'rename-changed'
  const prev = file.prevObjectId
  const next = file.newObjectId
  if (prev === '0000000' || prev === '0000000000000000000000000000000000000000') return 'new'
  if (next === '0000000' || next === '0000000000000000000000000000000000000000') return 'deleted'
  return 'change'
}

function getFileIcon(file: FileDiffMetadata | undefined, viewed: boolean, untrackedFiles: Set<string>) {
  const size = 16
  if (viewed) {
    return <FileCheck size={size} className="ft-icon icon-viewed" />
  }
  const changeType = file ? inferChangeType(file, untrackedFiles) : 'change'
  switch (changeType) {
    case 'new':
      return <FilePlus size={size} className="ft-icon icon-added" />
    case 'untracked':
      return <FileQuestion size={size} className="ft-icon icon-untracked" />
    case 'deleted':
      return <FileMinus size={size} className="ft-icon icon-deleted" />
    case 'rename-pure':
    case 'rename-changed':
      return <FileEdit size={size} className="ft-icon icon-renamed" />
    default:
      return <FileDiff size={size} className="ft-icon icon-modified" />
  }
}

function TreeDir({
  node,
  activeCard,
  commentCounts,
  viewedFiles,
  untrackedFiles,
  onFileClick,
  depth,
  defaultExpanded,
}: {
  node: TreeNode
  activeCard: string | null
  commentCounts: Record<string, number>
  viewedFiles: Set<string>
  untrackedFiles: Set<string>
  onFileClick: (domId: string) => void
  depth: number
  defaultExpanded: boolean
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <li>
      <div
        className="ft-row ft-dir"
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight
          size={14}
          className={`ft-chevron ${expanded ? 'ft-chevron-expanded' : ''}`}
        />
        {expanded ? (
          <FolderOpen size={16} className="ft-icon ft-folder-icon" />
        ) : (
          <Folder size={16} className="ft-icon ft-folder-icon" />
        )}
        <span className="ft-dir-name">{node.name}</span>
      </div>
      {expanded && (
        <ul className="ft-list">
          {node.children.map((child) =>
            child.isDir ? (
              <TreeDir
                key={child.domId ?? child.path}
                node={child}
                activeCard={activeCard}
                commentCounts={commentCounts}
                viewedFiles={viewedFiles}
                untrackedFiles={untrackedFiles}
                onFileClick={onFileClick}
                depth={depth + 1}
                defaultExpanded={true}
              />
            ) : (
              <TreeFile
                key={child.domId ?? child.path}
                node={child}
                activeCard={activeCard}
                commentCount={commentCounts[child.file?.name ?? ''] ?? 0}
                viewed={viewedFiles.has(child.file?.name ?? '')}
                untrackedFiles={untrackedFiles}
                onFileClick={onFileClick}
                depth={depth + 1}
              />
            ),
          )}
        </ul>
      )}
    </li>
  )
}

function TreeFile({
  node,
  activeCard,
  commentCount,
  viewed,
  untrackedFiles,
  onFileClick,
  depth,
}: {
  node: TreeNode
  activeCard: string | null
  commentCount: number
  viewed: boolean
  untrackedFiles: Set<string>
  onFileClick: (domId: string) => void
  depth: number
}) {
  const filePath = node.file?.name ?? node.path
  const domId = node.domId ?? `file-${filePath}`
  // Two entries for one path are two different cards, so the active one is
  // identified by its card, not by its path.
  const isActive = activeCard === domId

  return (
    <li>
      <div
        className={`ft-row ft-file ${isActive ? 'ft-file-active' : ''} ${viewed ? 'ft-file-viewed' : ''}`}
        style={{ paddingLeft: `${12 + depth * 16 + 20}px` }}
        onClick={() => onFileClick(domId)}
        title={filePath}
      >
        {getFileIcon(node.file, viewed, untrackedFiles)}
        <span className="ft-file-name">{node.name}</span>
        {commentCount > 0 && (
          <span className="ft-comment-count">
            <MessageSquare size={14} />
            {commentCount}
          </span>
        )}
      </div>
    </li>
  )
}

export function FileTree({ entries, activeCard, commentCounts, viewedFiles, untrackedFiles, onFileClick, collapsed, onToggleCollapse }: FileTreeProps) {
  const [filter, setFilter] = useState('')

  const filteredEntries = useMemo(() => {
    if (!filter) return entries
    const lower = filter.toLowerCase()
    return entries.filter((e) => e.file.name.toLowerCase().includes(lower))
  }, [entries, filter])

  const tree = useMemo(() => buildTree(filteredEntries), [filteredEntries])

  if (collapsed) {
    return (
      <div className="ft">
        <div className="ft-search">
          {onToggleCollapse && (
            <button
              className="sidebar-toggle"
              onClick={onToggleCollapse}
              title="Expand sidebar"
              aria-label="Expand sidebar"
            >
              <PanelLeftOpen size={16} />
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="ft">
      <div className="ft-search">
        {onToggleCollapse && (
          <button
            className="sidebar-toggle"
            onClick={onToggleCollapse}
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
          >
            <PanelLeftClose size={16} />
          </button>
        )}
        <div className="ft-search-wrapper">
          <Search size={14} className="ft-search-icon" />
          <input
            type="text"
            placeholder="Filter files..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="ft-search-input"
          />
        </div>
      </div>
      <ul className="ft-list ft-root">
        {tree.map((node) =>
          node.isDir ? (
            <TreeDir
              key={node.domId ?? node.path}
              node={node}
              activeCard={activeCard}
              commentCounts={commentCounts}
              viewedFiles={viewedFiles}
              untrackedFiles={untrackedFiles}
              onFileClick={onFileClick}
              depth={0}
              defaultExpanded={true}
            />
          ) : (
            <TreeFile
              key={node.domId ?? node.path}
              node={node}
              activeCard={activeCard}
              commentCount={commentCounts[node.file?.name ?? ''] ?? 0}
              viewed={viewedFiles.has(node.file?.name ?? '')}
              untrackedFiles={untrackedFiles}
              onFileClick={onFileClick}
              depth={0}
            />
          ),
        )}
      </ul>
    </div>
  )
}
