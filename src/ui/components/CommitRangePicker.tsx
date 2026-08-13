import { useState, useRef, useEffect } from 'react'
import { GitCommitHorizontal, ChevronDown } from 'lucide-react'
import type { CommitSummary } from '../../types'
import { DEFAULT_RANGE, type CommitRange } from '../hooks/useCommits'

const WORKING_TREE = ''

interface CommitRangePickerProps {
  commits: CommitSummary[]
  range: CommitRange
  /** Label for the default range, i.e. what the CLI was started with. */
  defaultLabel: string
  onChange: (range: CommitRange) => void
}

function shortSubject(subject: string): string {
  return subject.length > 60 ? `${subject.slice(0, 57)}…` : subject
}

function endLabel(sha: string, commits: CommitSummary[], workingTreeLabel: string): string {
  if (sha === WORKING_TREE) return workingTreeLabel
  const commit = commits.find((c) => c.sha === sha)
  return commit ? `${commit.shortSha} ${shortSubject(commit.subject)}` : sha.slice(0, 7)
}

export function CommitRangePicker({ commits, range, defaultLabel, onChange }: CommitRangePickerProps) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const isDefault = range.base === DEFAULT_RANGE.base && range.head === DEFAULT_RANGE.head
  const summary = isDefault
    ? defaultLabel
    : `${endLabel(range.base, commits, 'working tree')} → ${endLabel(range.head, commits, 'working tree')}`

  return (
    <div className="range-picker" ref={wrapperRef}>
      <button
        className={`btn btn-sm range-picker-btn ${open ? 'btn-active' : ''}`}
        onClick={() => setOpen(!open)}
        title="Choose which commits to diff"
      >
        <GitCommitHorizontal size={13} />
        <span className="range-picker-summary">{summary}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="range-picker-menu">
          {commits.length === 0 ? (
            <p className="range-picker-empty">This repository has no commits yet.</p>
          ) : (
            <>
              <label className="range-picker-field">
                <span className="range-picker-label">Base</span>
                <select
                  className="settings-select range-picker-select"
                  value={range.base}
                  onChange={(e) => onChange({ base: e.target.value, head: e.target.value ? range.head : '' })}
                >
                  <option value="">{defaultLabel}</option>
                  {commits.map((commit) => (
                    <option key={commit.sha} value={commit.sha}>
                      {commit.shortSha} {shortSubject(commit.subject)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="range-picker-field">
                <span className="range-picker-label">Compare</span>
                <select
                  className="settings-select range-picker-select"
                  value={range.head}
                  disabled={!range.base}
                  onChange={(e) => onChange({ ...range, head: e.target.value })}
                >
                  <option value={WORKING_TREE}>Working tree</option>
                  {commits.map((commit) => (
                    <option key={commit.sha} value={commit.sha}>
                      {commit.shortSha} {shortSubject(commit.subject)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="range-picker-actions">
                <button
                  className="btn btn-sm"
                  disabled={isDefault}
                  onClick={() => onChange(DEFAULT_RANGE)}
                >
                  Reset
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
