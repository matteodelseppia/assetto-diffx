import { describe, it, expect } from 'vitest'
import { isLoopbackHost } from '../../src/server.js'

describe('isLoopbackHost', () => {
  it('recognises the loopback binds, which stay open', () => {
    for (const host of ['127.0.0.1', '127.0.0.2', 'localhost', '::1', '[::1]']) {
      expect(isLoopbackHost(host), host).toBe(true)
    }
  })

  it('treats every other bind as reachable from elsewhere', () => {
    for (const host of ['0.0.0.0', '::', '192.168.1.10', '10.0.0.5', 'my-laptop.local']) {
      expect(isLoopbackHost(host), host).toBe(false)
    }
  })
})
