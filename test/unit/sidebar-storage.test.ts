import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  SidebarStorage,
  SIDEBAR_MIN_SIZE,
  SIDEBAR_COLLAPSED_SIZE,
} from '../../src/ui/sidebarStorage.js'

const STORAGE_KEY = 'assetto-diffx-sidebar-preferences'

function fakeLocalStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', fakeLocalStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SidebarStorage', () => {
  it('falls back to defaults when nothing is stored', () => {
    const storage = SidebarStorage.load()
    expect(storage.size).toBe(300)
    expect(storage.collapsed).toBe(false)
  })

  it('round-trips saved preferences', () => {
    SidebarStorage.load().withSize(420).save()
    expect(SidebarStorage.load().size).toBe(420)
  })

  it('ignores malformed stored JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{not json')
    expect(SidebarStorage.load().size).toBe(300)
  })

  it('ignores stored values of the wrong shape', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ size: 'wide', collapsed: false }))
    expect(SidebarStorage.load().size).toBe(300)
  })

  it('reports the collapsed size when collapsed', () => {
    const storage = SidebarStorage.load().withCollapsed(true)
    expect(storage.visibleSize()).toBe(SIDEBAR_COLLAPSED_SIZE)
    expect(storage.visibleSize(1000)).toBe(SIDEBAR_COLLAPSED_SIZE)
  })

  it('clamps the visible size to the available width', () => {
    const storage = SidebarStorage.load().withSize(800)
    expect(storage.visibleSize(500)).toBe(500)
    expect(storage.visibleSize()).toBe(800)
  })

  it('never shrinks below the minimum size', () => {
    const storage = SidebarStorage.load().withSize(800)
    expect(storage.visibleSize(50)).toBe(SIDEBAR_MIN_SIZE)
  })

  it('expands the sidebar when a size is set', () => {
    const storage = SidebarStorage.load().withCollapsed(true).withSize(350)
    expect(storage.collapsed).toBe(false)
    expect(storage.size).toBe(350)
  })

  it('keeps the size when toggling collapse', () => {
    const storage = SidebarStorage.load().withSize(350).withCollapsed(true)
    expect(storage.size).toBe(350)
    expect(storage.collapsed).toBe(true)
  })

  it('survives a localStorage that throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    })
    expect(() => SidebarStorage.load().withSize(400).save()).not.toThrow()
    expect(SidebarStorage.load().size).toBe(300)
  })
})
