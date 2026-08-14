import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createFixtureRepo, removeRepo, startCli, type RunningServer } from './helpers.js'

let repo: string
let server: RunningServer
let base: string
let token: string

beforeAll(async () => {
  repo = createFixtureRepo()
  // Exposed to the network, which is what turns the token on.
  server = await startCli(repo, ['--host', '0.0.0.0'])
  const url = new URL(server.url)
  token = url.searchParams.get('token') ?? ''
  // 0.0.0.0 is a bind address, not one to connect to.
  base = `http://127.0.0.1:${url.port}`
})

afterAll(async () => {
  await server?.stop()
  if (repo) removeRepo(repo)
})

describe('a server bound past loopback', () => {
  it('prints a link carrying an access token', () => {
    expect(token).toMatch(/^[0-9a-f]{48}$/)
  })

  it('refuses API requests without the token', async () => {
    expect((await fetch(`${base}/api/diff`)).status).toBe(401)
    expect((await fetch(`${base}/api/comments`)).status).toBe(401)
  })

  it('refuses to create a comment without the token', async () => {
    const res = await fetch(`${base}/api/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: 'src/modified.ts', side: 'deletions', lineNumber: 1, body: 'hi' }),
    })
    expect(res.status).toBe(401)
    expect((await fetch(`${base}/api/comments?token=${token}`)).status).toBe(200)
    expect(await (await fetch(`${base}/api/comments?token=${token}`)).json()).toEqual([])
  })

  it('refuses the page and its assets without the token', async () => {
    expect((await fetch(`${base}/`)).status).toBe(401)
  })

  it('rejects a wrong token', async () => {
    expect((await fetch(`${base}/api/diff?token=${'0'.repeat(48)}`)).status).toBe(401)
    expect((await fetch(`${base}/api/diff?token=short`)).status).toBe(401)
  })

  it('accepts the token as a query parameter, a header, or the cookie it hands out', async () => {
    const fromQuery = await fetch(`${base}/api/diff?token=${token}`)
    expect(fromQuery.status).toBe(200)

    const fromCookie = await fetch(`${base}/api/diff`, {
      headers: { cookie: `assetto_diffx_token=${token}` },
    })
    expect(fromCookie.status).toBe(200)

    const fromHeader = await fetch(`${base}/api/diff`, { headers: { 'x-auth-token': token } })
    expect(fromHeader.status).toBe(200)
  })

  it('hands the page a cookie that its own assets can then use', async () => {
    // The page is served by a route that builds its own Response, which is
    // where a cookie set before the handler runs would be lost — and then the
    // bundle it asks for next is refused and nothing renders.
    const page = await fetch(`${base}/?token=${token}`)
    expect(page.status).toBe(200)

    const setCookie = page.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain(`assetto_diffx_token=${token}`)
    expect(setCookie).toContain('HttpOnly')

    const html = await page.text()
    const asset = html.match(/(?:src|href)="(\/assets\/[^"]+)"/)?.[1]
    expect(asset, 'no asset referenced by index.html').toBeDefined()

    const withCookie = await fetch(`${base}${asset}`, {
      headers: { cookie: `assetto_diffx_token=${token}` },
    })
    expect(withCookie.status).toBe(200)
    expect((await fetch(`${base}${asset}`)).status).toBe(401)
  })
})

describe('a server on the default loopback bind', () => {
  let loopback: RunningServer

  beforeAll(async () => {
    loopback = await startCli(repo)
  })

  afterAll(async () => {
    await loopback?.stop()
  })

  it('needs no token', async () => {
    expect(loopback.url).not.toContain('token')
    expect((await fetch(`${loopback.url}/api/diff`)).status).toBe(200)
  })
})
