import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export const projectRoot = resolve(import.meta.dirname, '..', '..')
export const cliPath = join(projectRoot, 'dist', 'cli.mjs')

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: 'pipe' })
}

/**
 * A throwaway git repository with a committed baseline, one modified file,
 * one staged file and one untracked file.
 */
export function createFixtureRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'assetto-diffx-repo-'))
  git(dir, 'init', '-b', 'main')
  git(dir, 'config', 'user.email', 'ci@example.com')
  git(dir, 'config', 'user.name', 'CI')
  git(dir, 'config', 'commit.gpgsign', 'false')

  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'src', 'modified.ts'), 'export const value = 1\nexport const other = 2\n')
  writeFileSync(join(dir, 'src', 'staged.ts'), 'export const staged = 1\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-m', 'baseline')

  writeFileSync(join(dir, 'src', 'modified.ts'), 'export const value = 42\nexport const other = 2\n')
  writeFileSync(join(dir, 'src', 'staged.ts'), 'export const staged = 99\n')
  git(dir, 'add', 'src/staged.ts')
  writeFileSync(join(dir, 'src', 'untracked.ts'), 'export const fresh = true\n')

  return dir
}

export interface RunningServer {
  url: string
  stop(): Promise<void>
}

/** Starts the built CLI inside `cwd` and waits until it reports its URL. */
export async function startCli(cwd: string, extraArgs: string[] = []): Promise<RunningServer> {
  if (!existsSync(cliPath)) {
    throw new Error(`${cliPath} is missing — run \`pnpm build\` before the system tests`)
  }

  // Point HOME at a scratch directory so the CLI never reads or writes the
  // real user's settings file.
  const home = mkdtempSync(join(tmpdir(), 'assetto-diffx-home-'))

  const child = spawn(process.execPath, [cliPath, '--no-open', ...extraArgs], {
    cwd,
    env: { ...process.env, HOME: home, USERPROFILE: home, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const url = await new Promise<string>((resolvePromise, rejectPromise) => {
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      rejectPromise(new Error(`CLI did not start in time.\nstdout: ${stdout}\nstderr: ${stderr}`))
    }, 30_000)

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      const match = stdout.match(/running at (http:\/\/\S+)/)
      if (match) {
        clearTimeout(timer)
        resolvePromise(match[1])
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      rejectPromise(new Error(`CLI exited with code ${code}.\nstdout: ${stdout}\nstderr: ${stderr}`))
    })
  })

  return {
    url,
    stop: () => stopChild(child, home),
  }
}

function stopChild(child: ChildProcess, home: string): Promise<void> {
  return new Promise((resolvePromise) => {
    const done = () => {
      rmSync(home, { recursive: true, force: true })
      resolvePromise()
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      done()
      return
    }
    child.once('exit', done)
    child.kill('SIGKILL')
  })
}

export function removeRepo(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}
