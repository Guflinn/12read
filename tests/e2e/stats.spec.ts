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
  // 14 根柱子挤在 380px 的弹窗里，日期标签必须收在自己那列宽度内，不能压到隔壁（回归：曾横排压字）
  const labelsFit = await page.evaluate(() => {
    const bars = Array.from(document.querySelectorAll('#stats-bars .stats-bar'))
    const widths = bars.map((bar) => bar.getBoundingClientRect().width)
    return bars.every((bar, index) => {
      const label = bar.querySelector('.stats-bar-day')
      if (!label) return false
      const lb = label.getBoundingClientRect()
      return lb.width <= widths[index] + 1
    })
  })
  expect(labelsFit).toBe(true)
  // 月、日两行都在，且日期拆开（不是 'MM-DD' 一整串）
  await expect(page.locator('#stats-bars .stats-bar-day .stats-day-m').first()).toHaveText(/^\d{2}$/)
  await expect(page.locator('#stats-bars .stats-bar-day .stats-day-d').first()).toHaveText(/^\d{2}$/)
  await expect(page.locator('#stats-top-empty')).toBeVisible()

  await page.locator('.modal-actions .btn.primary').click()
  await expect(page.locator('.modal')).toHaveCount(0)
})

test('字数去重：同一段来回刷，今天读的字数不会跟着涨（0.1.4）', async () => {
  const bookPath = writeNovelFile(makeTempDir('12read-stat-dedup-src-'), '去重书.txt', buildNovel())
  const page = await openApp(makeTempDir('12read-stat-dedup-'))
  if (!app) throw new Error('应用未启动')
  await stubOpenDialog(app, [bookPath])
  await page.click('#btn-import')
  await page.click('.book-card')
  await expect(page.locator('.chapter-title')).toHaveText('第一章 起点')

  const scrollTo = (top: number): Promise<void> =>
    page.locator('#reader-scroll').evaluate((el, value) => {
      el.scrollTop = value
    }, top)

  /**
   * 直接问主进程要今天读了多少字（不离开阅读器）——
   * 一旦回书架再进来，进章点就变了，验不出水位线本身。
   */
  const todayChars = (): Promise<number> =>
    page.evaluate(async () => {
      const api = (
        window as unknown as {
          reader: { getReadingStats(days: number): Promise<{ todayChars: number }> }
        }
      ).reader
      return (await api.getReadingStats(1)).todayChars
    })

  /** 停下读一会儿：等足「停 2 秒才算读过」的节拍。 */
  const readPause = async (top: number): Promise<void> => {
    await scrollTo(top)
    await page.waitForTimeout(2600)
  }

  // 往前读两屏（进书时停在 0，所以这一章的水位线从 0 起算）
  await readPause(400)
  await readPause(900)
  const afterFirstRead = await todayChars()
  expect(afterFirstRead).toBeGreaterThan(0)

  // 在刚读过的那一段来回刷两遍：每次都停够 2 秒，所以都会上报
  for (let i = 0; i < 2; i += 1) {
    await readPause(300)
    await readPause(900)
  }

  // 还是那么多字：同一段内容当天只算一次（旧逻辑这里会翻好几倍）
  expect(await todayChars()).toBe(afterFirstRead)
})
