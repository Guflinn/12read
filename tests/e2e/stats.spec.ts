import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { buildNovel, launchApp, makeTempDir, stubOpenDialog, writeNovelFile } from './helpers'

// 阅读统计（0.1.3 第 8 项）走一遍真实链路：书架入口 → stat:get → 面板渲染。
// serial：每个用例都要独占一棵真实的 Electron 进程。
test.describe.configure({ mode: 'serial' })

let app: ElectronApplication | null = null

async function openApp(dataDir: string): Promise<Page> {
  app = await launchApp(dataDir)
  const page = await app.firstWindow()
  await page.waitForSelector('#btn-import')
  return page
}

test.afterEach(async () => {
  await app?.close()
  app = null
})

test('阅读统计：书架打开面板，今天与累计、近两周柱子、空榜提示都在', async () => {
  const bookPath = writeNovelFile(makeTempDir('12read-stat-src-'), '统计书.txt', buildNovel())
  const page = await openApp(makeTempDir('12read-stat-'))
  if (!app) throw new Error('应用未启动')
  await stubOpenDialog(app, [bookPath])
  await page.click('#btn-import')
  await expect(page.locator('.book-card')).toHaveCount(1)

  await page.click('#btn-stats')
  const dialog = page.getByRole('dialog', { name: '阅读统计' })
  await expect(dialog).toBeVisible()
  // 还没进过阅读器：今天与累计都是 0，柱子照常铺满 14 天
  await expect(page.locator('#stats-today')).toHaveText('0 分钟')
  await expect(page.locator('#stats-total')).toHaveText('0 分钟')
  await expect(page.locator('#stats-streak')).toHaveText('0 天')
  await expect(page.locator('#stats-bars .stats-bar')).toHaveCount(14)
  await expect(page.locator('#stats-top-empty')).toBeVisible()

  await page.locator('.modal-actions .btn.primary').click()
  await expect(page.locator('.modal')).toHaveCount(0)
})
