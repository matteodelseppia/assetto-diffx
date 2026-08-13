import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { createFixtureRepo, removeRepo, startCli, git, cliPath, projectRoot, type RunningServer } from './helpers.js'

function runCli(cwd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [cliPath, ...args], {
      cwd,
      encoding: 'utf-8',
      stdio: 'pipe',
    })
    return { status: 0, stdout, stderr: '' }
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string }
    return { status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }
  }
}

describe('assetto-diffx CLI', () => {
  let repo: string

  beforeAll(() => {
    repo = createFixtureRepo()
  })

  afterAll(() => {
    if (repo) removeRepo(repo)
  })

  it('prints usage for --help and exits successfully', () => {
    const { status, stdout } = runCli(repo, ['--help'])
    expect(status).toBe(0)
    expect(stdout).toContain('Usage: assetto-diffx')
    expect(stdout).toContain('--no-open')
  })

  it('prints the package version for --version', () => {
    const { status, stdout } = runCli(repo, ['--version'])
    const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf-8'))
    expect(status).toBe(0)
    expect(stdout.trim()).toBe(pkg.version)
  })

  it('exits with an error outside a git repository', () => {
    const notARepo = mkdtempSync(join(tmpdir(), 'assetto-diffx-plain-'))
    try {
      const { status, stderr } = runCli(notARepo, ['--no-open'])
      expect(status).toBe(1)
      expect(stderr).toContain('not inside a git repository')
    } finally {
      rmSync(notARepo, { recursive: true, force: true })
    }
  })

  it('binds the port it is given', async () => {
    const server = await startCli(repo, ['-p', '38571'])
    try {
      expect(server.url).toBe('http://127.0.0.1:38571')
      expect((await fetch(`${server.url}/api/diff`)).status).toBe(200)
    } finally {
      await server.stop()
    }
  })
})

describe('custom diff mode', () => {
  let repo: string
  let server: RunningServer

  beforeAll(async () => {
    repo = createFixtureRepo()
    git(repo, 'add', '.')
    git(repo, 'commit', '-m', 'second commit')
    server = await startCli(repo, ['--', 'HEAD~1..HEAD'])
  })

  afterAll(async () => {
    await server?.stop()
    if (repo) removeRepo(repo)
  })

  it('diffs the requested revision range', async () => {
    const res = await fetch(`${server.url}/api/diff`)
    const body = (await res.json()) as { patch: string; customMode: boolean }
    expect(body.customMode).toBe(true)
    expect(body.patch).toContain('+export const value = 42')
    expect(body.patch).toContain('src/untracked.ts')
  })
})
