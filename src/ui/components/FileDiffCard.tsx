import { memo } from 'react'
import { FileDiff } from '@pierre/diffs/react'
import type { DiffLineAnnotation, FileDiffMetadata, AnnotationSide, SelectedLineRange } from '@pierre/diffs'
import type { ReviewComment } from '../../types'
import type { NewComment } from '../hooks/useComments'
import type { CommentTarget } from '../utils'
import { commentTargetFromRange } from '../utils'
import { CommentForm } from './CommentForm'
import { CommentBubble } from './CommentBubble'

interface FileDiffCardProps {
  id?: string
  fileDiff: FileDiffMetadata
  filePath: string
  annotations: DiffLineAnnotation<ReviewComment>[]
  diffStyle: 'split' | 'unified'
  tabSize: number
  softWrap: boolean
  viewed: boolean
  /** The lines being dragged over, when this is the file being selected in. */
  selection: SelectedLineRange | null
  /** The lines the open comment form covers, when it belongs to this file. */
  target: CommentTarget | null
  onViewedChange: (filePath: string, viewed: boolean) => void
  onSelectionStart: (filePath: string) => void
  onSelectionChange: (filePath: string, selection: SelectedLineRange | null) => void
  onTargetChange: (filePath: string, target: CommentTarget | null) => void
  onAddComment: (comment: NewComment) => void
  onDeleteComment: (id: string) => void
}

export const FileDiffCard = memo(function FileDiffCard({
  id,
  fileDiff,
  filePath,
  annotations,
  diffStyle,
  tabSize,
  softWrap,
  viewed,
  selection,
  target,
  onViewedChange,
  onSelectionStart,
  onSelectionChange,
  onTargetChange,
  onAddComment,
  onDeleteComment,
}: FileDiffCardProps) {
  // Once a range has been handed to the comment form, the form owns it and the
  // diff carries no selection: a leftover one would make the next gutter drag
  // extend the old range instead of starting where the reviewer pressed.
  const selectedLines = target ? null : selection

  const getLineContent = (side: AnnotationSide, lineNumber: number): string => {
    const lines = side === 'additions' ? fileDiff.additionLines : fileDiff.deletionLines
    // Full (non-partial) diffs carry the entire file, so any line — including
    // expanded context outside hunks — can be addressed directly.
    if (!fileDiff.isPartial) {
      return lines[lineNumber - 1] ?? ''
    }
    const startKey = side === 'additions' ? 'additionStart' : 'deletionStart'
    const countKey = side === 'additions' ? 'additionCount' : 'deletionCount'
    const indexKey = side === 'additions' ? 'additionLineIndex' : 'deletionLineIndex'
    for (const hunk of fileDiff.hunks) {
      const start = hunk[startKey]
      const count = hunk[countKey]
      if (lineNumber >= start && lineNumber < start + count) {
        const index = hunk[indexKey] + (lineNumber - start)
        return lines[index] ?? ''
      }
    }
    return ''
  }

  const getRangeContents = ({ side, startLine, endLine }: CommentTarget): string[] => {
    const contents: string[] = []
    for (let line = startLine; line <= endLine; line++) {
      // Diff lines carry their line ending; a comment quotes the code alone.
      contents.push(getLineContent(side, line).replace(/\r?\n$/, ''))
    }
    return contents
  }

  const allAnnotations: DiffLineAnnotation<ReviewComment | { _pending: true }>[] = [
    ...annotations,
    ...(target
      ? [
          {
            side: target.side,
            // A range comment hangs below its last line, as on GitHub.
            lineNumber: target.endLine,
            metadata: { _pending: true as const },
          },
        ]
      : []),
  ]

  return (
    <div className={`file-diff-card ${viewed ? 'file-diff-viewed' : ''}`} id={id}>
      {viewed ? (
        <div className="file-diff-viewed-header">
          <span className="file-diff-viewed-name">{filePath}</span>
          <label className="viewed-label viewed-checked" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={viewed}
              onChange={(e) => onViewedChange(filePath, e.target.checked)}
            />
            Viewed
          </label>
        </div>
      ) : (
        <>
          <FileDiff<ReviewComment | { _pending: true }>
            fileDiff={fileDiff}
            options={{
              diffStyle,
              stickyHeader: true,
              expansionLineCount: 20,
              // The gutter's own "+" reports the range it was dragged over,
              // and dragging the line numbers selects that range up front. The
              // two cannot be combined with a custom gutter button, so the
              // built-in one is styled through unsafeCSS below.
              enableGutterUtility: true,
              enableLineSelection: true,
              onLineSelectionChange: (range) => onSelectionChange(filePath, range),
              onLineSelected: (range) => onSelectionChange(filePath, range),
              // Selecting elsewhere abandons a comment that was never sent.
              onLineSelectionStart: () => onSelectionStart(filePath),
              onGutterUtilityClick: (range) => onTargetChange(filePath, commentTargetFromRange(range)),
              theme: { dark: 'github-dark', light: 'github-light' },
              themeType: 'system',
              overflow: softWrap ? 'wrap' : 'scroll',
              unsafeCSS: `
                :host { --diffs-tab-size: ${tabSize}; }
                [data-utility-button] {
                  background-color: var(--primary);
                  border-radius: 50%;
                }
                [data-utility-button]:active { cursor: ns-resize; }
              `,
            }}
            lineAnnotations={allAnnotations}
            selectedLines={selectedLines}
            renderHeaderMetadata={() => (
              <label className="viewed-label" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={viewed}
                  onChange={(e) => onViewedChange(filePath, e.target.checked)}
                />
                Viewed
              </label>
            )}
            renderAnnotation={(annotation) => {
              if ('_pending' in annotation.metadata) {
                const { side, startLine, endLine } = target!
                return (
                  <CommentForm
                    startLine={startLine}
                    endLine={endLine}
                    onSubmit={(body) => {
                      onAddComment({
                        filePath,
                        side,
                        startLineNumber: startLine,
                        lineNumber: endLine,
                        lineContents: getRangeContents(target!),
                        body,
                      })
                      onTargetChange(filePath, null)
                    }}
                    onCancel={() => onTargetChange(filePath, null)}
                  />
                )
              }
              return (
                <CommentBubble
                  comment={annotation.metadata as ReviewComment}
                  onDelete={onDeleteComment}
                />
              )
            }}
          />
        </>
      )}
    </div>
  )
})
