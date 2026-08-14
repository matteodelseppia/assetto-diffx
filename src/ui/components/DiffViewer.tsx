import { memo, useCallback, useMemo, useState } from 'react'
import type { DiffLineAnnotation, SelectedLineRange } from '@pierre/diffs'
import type { ReviewComment } from '../../types'
import type { BinaryFileInfo } from '../hooks/useDiff'
import type { NewComment } from '../hooks/useComments'
import type { CommentTarget } from '../utils'
import type { CommitRange } from '../hooks/useCommits'
import type { DiffEntry } from '../fileTree'
import { FileDiffCard } from './FileDiffCard'
import { BinaryFileDiff } from './BinaryFileDiff'

interface DiffViewerProps {
  entries: DiffEntry[]
  diffStyle: 'split' | 'unified'
  tabSizeMap: Record<string, number>
  defaultTabSize: number
  softWrap: boolean
  viewedFiles: Set<string>
  binaryFiles: Map<string, BinaryFileInfo>
  range: CommitRange
  onViewedChange: (filePath: string, viewed: boolean) => void
  fileAnnotationsMap: Map<string, DiffLineAnnotation<ReviewComment>[]>
  onAddComment: (comment: NewComment) => void
  onDeleteComment: (id: string) => void
  onReplyComment: (id: string, body: string) => void
}

const emptyAnnotations: DiffLineAnnotation<ReviewComment>[] = []

/**
 * Where the reviewer is composing a comment. Only one file is ever selecting or
 * holding an unsent comment form, so selecting lines anywhere abandons the form
 * that was open elsewhere rather than leaving a second one behind.
 */
interface ActiveComment {
  filePath: string
  selection: SelectedLineRange | null
  target: CommentTarget | null
}

export const DiffViewer = memo(function DiffViewer({
  entries,
  diffStyle,
  tabSizeMap,
  defaultTabSize,
  softWrap,
  viewedFiles,
  binaryFiles,
  range,
  onViewedChange,
  fileAnnotationsMap,
  onAddComment,
  onDeleteComment,
  onReplyComment,
}: DiffViewerProps) {
  const [active, setActive] = useState<ActiveComment | null>(null)

  const handleSelectionStart = useCallback((filePath: string) => {
    setActive({ filePath, selection: null, target: null })
  }, [])

  const handleSelectionChange = useCallback((filePath: string, selection: SelectedLineRange | null) => {
    setActive((prev) => ({
      filePath,
      selection,
      target: prev?.filePath === filePath ? prev.target : null,
    }))
  }, [])

  const handleTargetChange = useCallback((filePath: string, target: CommentTarget | null) => {
    setActive(target ? { filePath, selection: null, target } : null)
  }, [])

  const sortedEntries = useMemo(() => {
    return [...entries].sort((a, b) => {
      const partsA = a.file.name.split('/')
      const partsB = b.file.name.split('/')
      const len = Math.min(partsA.length, partsB.length)
      for (let i = 0; i < len; i++) {
        const aIsDir = i < partsA.length - 1
        const bIsDir = i < partsB.length - 1
        if (aIsDir !== bIsDir) return aIsDir ? -1 : 1
        const cmp = partsA[i].localeCompare(partsB[i])
        if (cmp !== 0) return cmp
      }
      return partsA.length - partsB.length
    })
  }, [entries])

  if (sortedEntries.length === 0) {
    return (
      <div className="empty-state">
        <p>No changes found.</p>
      </div>
    )
  }

  return (
    <div className="diff-viewer">
      {sortedEntries.map(({ file, domId }) => {
        const filePath = file.name
        const binaryInfo = binaryFiles.get(filePath)
        if (binaryInfo) {
          return (
            <BinaryFileDiff
              key={domId}
              id={domId}
              filePath={filePath}
              info={binaryInfo}
              viewed={viewedFiles.has(filePath)}
              range={range}
              onViewedChange={onViewedChange}
            />
          )
        }
        return (
          <FileDiffCard
            // Include isPartial in the key so the card remounts when a file is
            // upgraded from a partial (patch-only) to a full diff. The
            // @pierre/diffs <FileDiff> under the Virtualizer does not re-process
            // an in-place fileDiff change, so without a remount the upgraded
            // diff never renders and hunk-context expansion controls never appear.
            key={`${domId}-${file.isPartial ? 'p' : 'f'}`}
            id={domId}
            fileDiff={file}
            filePath={filePath}
            annotations={fileAnnotationsMap.get(filePath) ?? emptyAnnotations}
            diffStyle={diffStyle}
            tabSize={tabSizeMap[filePath] ?? defaultTabSize}
            softWrap={softWrap}
            viewed={viewedFiles.has(filePath)}
            selection={active?.filePath === filePath ? active.selection : null}
            target={active?.filePath === filePath ? active.target : null}
            onViewedChange={onViewedChange}
            onSelectionStart={handleSelectionStart}
            onSelectionChange={handleSelectionChange}
            onTargetChange={handleTargetChange}
            onAddComment={onAddComment}
            onDeleteComment={onDeleteComment}
            onReplyComment={onReplyComment}
          />
        )
      })}
    </div>
  )
})
