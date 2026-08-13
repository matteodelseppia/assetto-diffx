import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // System tests build the CLI and spawn a real server, so they need more
    // headroom than the vitest default.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
})
