import { createServer, type Server } from 'node:http'
import { expect, test } from '@playwright/test'
import { launchApp, makeTempDir } from './helpers'

/**
 * 检查更新（0.1.5）：只提示不下载。
 *
 * 网络不可控，所以这里分两条路：
 * - 手动检查：只要求「给了一句准话」，三种结果（最新 / 有新版 / 连不上）都算过；
 * - 「有新版本」提示：用本地假更新源喂一个比本机新的版本号，完全确定性。
 */
test.describe.configure({ mode: 'serial' })

let app: Awaited<ReturnType<typeof launchApp>> | null = null

/** 起一个本地假「更新源」，返回地址；用完记得关。 */
async function fakeFeed(payload: unknown): Promise<{ url: string; server: Server }> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(payload))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return { url: 'http://127.0.0.1:' + port + '/releases', server }
}

test.afterEach(async () => {
  delete process.env['TWELVE_READ_UPDATE_FEED']
  if (app) {
    await app.close()
    app = null
  }
})

test('书架左下角能手动检查更新，三种结果至少给一句准话', async () => {
  app = await launchApp(makeTempDir('12read-upd-'))
  const page = await app.firstWindow()
  await page.waitForSelector('#btn-import')

  const button = page.locator('#btn-check-update')
  await expect(button).toBeVisible()
  await expect(button).toHaveText('检查更新')

  await button.click()
  // 真实网络下三种结果都可能：只要不是「点了没反应」就行
  await expect(page.locator('#toast')).toHaveText(
    /已是最新版本 v|发现新版本 v|检查更新失败/,
    { timeout: 20_000 }
  )
  // 没新版时不该出现「去下载」那行
  await expect(page.locator('#update-notice')).toHaveCount(0)
})

test('远端有新版时，书架显示「有新版本 … · 去下载」（0.1.5）', async () => {
  const feed = await fakeFeed([
    {
      tag_name: 'v9.9.9',
      html_url: 'https://github.com/Guflinn/12read/releases/tag/v9.9.9',
      published_at: '2026-10-07T00:00:00Z'
    }
  ])
  // 更新源在 main 侧读环境变量，launchApp 会把当前 process.env 传下去
  process.env['TWELVE_READ_UPDATE_FEED'] = feed.url

  try {
    app = await launchApp(makeTempDir('12read-upd-new-'))
    const page = await app.firstWindow()
    await page.waitForSelector('#btn-import')

    // 进书架就自动静默查一次：发现新版 → 左下角出现可点的提示
    await expect(page.locator('#update-notice')).toHaveText('有新版本 v9.9.9 · 去下载', {
      timeout: 20_000
    })
  } finally {
    feed.server.close()
  }
})

test('远端与本地同版本时，不显示「有新版本」提示', async () => {
  const feed = await fakeFeed([
    {
      tag_name: 'v0.0.1',
      html_url: 'https://github.com/Guflinn/12read/releases/tag/v0.0.1',
      published_at: '2026-01-01T00:00:00Z'
    }
  ])
  process.env['TWELVE_READ_UPDATE_FEED'] = feed.url

  try {
    app = await launchApp(makeTempDir('12read-upd-old-'))
    const page = await app.firstWindow()
    await page.waitForSelector('#btn-import')

    // 点一次手动检查确认有走完流程，同时确认没有误报
    await page.click('#btn-check-update')
    await expect(page.locator('#toast')).toHaveText(/已是最新版本 v/, { timeout: 20_000 })
    await expect(page.locator('#update-notice')).toHaveCount(0)
  } finally {
    feed.server.close()
  }
})
