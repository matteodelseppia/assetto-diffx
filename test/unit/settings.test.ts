import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'

// settings.ts resolves the config path at import time from the home directory,
// so the fake home has to be in place before the module is loaded.
let home: string
let settingsFile: string

async function importSettings() {
  vi.resetModules()
  return import('../../src/settings.js')
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'assetto-diffx-home-'))
  process.env.HOME = home
  process.env.USERPROFILE = home
  settingsFile = join(home, '.config', 'assetto-diffx', 'settings.json')
  expect(homedir()).toBe(home)
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe('loadSettings', () => {
  it('returns defaults when no settings file exists', async () => {
    const { loadSettings } = await importSettings()
    expect(loadSettings()).toEqual({
      staged: true,
      untracked: true,
      diffStyle: 'split',
      defaultTabSize: 4,
    })
  })

  it('merges stored values over the defaults', async () => {
    mkdirSync(join(home, '.config', 'assetto-diffx'), { recursive: true })
    writeFileSync(settingsFile, JSON.stringify({ diffStyle: 'unified' }))
    const { loadSettings } = await importSettings()
    const settings = loadSettings()
    expect(settings.diffStyle).toBe('unified')
    expect(settings.defaultTabSize).toBe(4)
  })

  it('falls back to defaults when the file is corrupt', async () => {
    mkdirSync(join(home, '.config', 'assetto-diffx'), { recursive: true })
    writeFileSync(settingsFile, 'not json')
    const { loadSettings } = await importSettings()
    expect(loadSettings().diffStyle).toBe('split')
  })
})

describe('saveSettings', () => {
  it('creates the config directory and persists a partial update', async () => {
    const { saveSettings, loadSettings } = await importSettings()
    const saved = saveSettings({ defaultTabSize: 2 })
    expect(saved.defaultTabSize).toBe(2)
    expect(saved.staged).toBe(true)
    expect(loadSettings().defaultTabSize).toBe(2)
  })

  it('keeps previously saved values across updates', async () => {
    const { saveSettings, loadSettings } = await importSettings()
    saveSettings({ defaultTabSize: 2 })
    saveSettings({ diffStyle: 'unified' })
    expect(loadSettings()).toMatchObject({ defaultTabSize: 2, diffStyle: 'unified' })
  })
})
