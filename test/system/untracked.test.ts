import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { git, removeRepo, startCli, type RunningServer } from './helpers.js'

/**
 * A repository whose untracked files cover the three shapes a text file can
 * have: ending with a newline, not ending with one, and empty.
 */
function createUntrackedRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'assetto-diffx-untracked-'))
  git(dir, 'init', '-b', 'main')
  git(dir, 'config', 'user.email', 'ci@example.com')
  git(dir, 'config', 'user.name', 'CI')
  git(dir, 'config', 'commit.gpgsign', 'false')

  writeFileSync(join(dir, 'baseline.txt'), 'baseline\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-m', 'baseline')

  writeFileSync(join(dir, 'newline.txt'), 'one\ntwo\n')
  writeFileSync(join(dir, 'no-newline.txt'), 'one\ntwo')
  writeFileSync(join(dir, 'empty.txt'), '')

  return dir
}

let repo: string
let server: RunningServer
let patch: string

/** The part of the patch that describes one file. */
function chunkFor(file: string): string {
  const chunk = patch
    .split(/^(?=diff --git )/m)
    .find((c) => c.startsWith(`diff --git a/${file} b/${file}`))
  expect(chunk, `no chunk for ${file}`).toBeDefined()
  return chunk!.trimEnd()
}

/**
 * How git itself describes the same content, so the generated patch can be
 * held against the real thing rather than against a hand-written expectation.
 */
function gitPatchFor(file: string): string {
  git(repo, 'add', file)
  const staged = git(repo, 'diff', '--no-ext-diff', '--no-color', '--staged', '--', file)
  git(repo, 'reset', '--quiet', '--', file)
  // Only the blob id differs: the synthetic patch cannot compute one.
  return staged.replace(/^index [0-9a-f]+\.\.[0-9a-f]+.*$/m, '').trimEnd()
}

function withoutIndexLine(chunk: string): string {
  return chunk.replace(/^index [0-9a-f]+\.\.[0-9a-f]+.*$/m, '').trimEnd()
}

beforeAll(async () => {
  repo = createUntrackedRepo()
  server = await startCli(repo)
  const res = await fetch(`${server.url}/api/diff?untracked=true`)
  patch = ((await res.json()) as { patch: string }).patch
})

afterAll(async () => {
  await server?.stop()
  if (repo) removeRepo(repo)
})

describe('untracked files in the diff', () => {
  it('does not add a line for the trailing newline', () => {
    const chunk = chunkFor('newline.txt')
    expect(chunk).toContain('@@ -0,0 +1,2 @@')
    expect(chunk.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'))).toEqual(['+one', '+two'])
  })

  it('flags a file that does not end with a newline, as git does', () => {
    const chunk = chunkFor('no-newline.txt')
    expect(chunk).toContain('@@ -0,0 +1,2 @@')
    expect(chunk).toContain('\\ No newline at end of file')
  })

  it('reports an empty file without a hunk', () => {
    const chunk = chunkFor('empty.txt')
    expect(chunk).toContain('new file mode')
    expect(chunk).not.toContain('@@')
  })

  it('matches what git reports for the same content', () => {
    for (const file of ['newline.txt', 'no-newline.txt', 'empty.txt']) {
      expect(withoutIndexLine(chunkFor(file)), file).toBe(gitPatchFor(file))
    }
  })
})
