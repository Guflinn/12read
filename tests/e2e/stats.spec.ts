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

/** 直接从渲染层调 API 给「今天」记一段时间：跳过 15 秒的节拍，专测界面怎么显示。 */
async function seedToday(page: Page, ms: number): Promise<void> {
  await page.evaluate(async (amount) => {
    const api = (
      window as unknown as {
        reader: {
          listBooks(): Promise<Array<{ id: string }>>
          addReadingStat(bookId: string, ms: number, chars: number): Promise<void>
        }
      }
    ).reader
    const books = await api.listBooks()
    const first = books[0]
    if (first) await api.addReadingStat(first.id, amount, 0)
  }, ms)
}

test('书架显示今天读了多久，设了目标还会显示进度与「已达标」（0.1.4）', async () => {
  const bookPath = writeNovelFile(makeTempDir('12read-today-src-'), '今日书.txt', buildNovel())
  const page = await openApp(makeTempDir('12read-today-'))
  if (!app) throw new Error('应用未启动')
  await stubOpenDialog(app, [bookPath])
  await page.click('#btn-import')
  await expect(page.locator('.book-card')).toHaveCount(1)

  // 还没读过、也没设目标：这行不显示
  await expect(page.locator('#shelf-today')).toHaveCount(0)

  await seedToday(page, 12 * 60_000)
  await page.reload()
  await page.waitForSelector('#btn-import')
  await expect(page.locator('#shelf-today')).toHaveText('今天已读 12 分钟')

  // 在阅读器里把每日目标设成 30 分钟
  await page.click('.book-card')
  await page.waitForSelector('#reader-content p')
  await page.click('#btn-settings')
  await expect(page.locator('#settings-sheet')).toHaveClass(/on/)
  await page.click('#goal-30')
  await page.keyboard.press('Escape')

  // 回书架：这行变成带进度的样子
  await page.click('#btn-back')
  await page.waitForSelector('#btn-import')
  await expect(page.locator('#shelf-today')).toHaveText('今天已读 12 / 30 分钟')

  // 再攒到超过目标 → 写「已达标」
  await seedToday(page, 20 * 60_000)
  await page.reload()
  await page.waitForSelector('#btn-import')
  await expect(page.locator('#shelf-today')).toHaveText('今天已读 32 / 30 分钟 · 已达标')
})

test('统计面板：切到日历看整月格子，能翻到上个月（0.1.4）', async () => {
  const bookPath = writeNovelFile(makeTempDir('12read-cal-src-'), '日历书.txt', buildNovel())
  const page = await openApp(makeTempDir('12read-cal-'))
  if (!app) throw new Error('应用未启动')
  await stubOpenDialog(app, [bookPath])
  await page.click('#btn-import')
  await expect(page.locator('.book-card')).toHaveCount(1)

  // 给今天记 20 分钟，日历上今天那格就该有色
  await seedToday(page, 20 * 60_000)

  await page.click('#btn-stats')
  await expect(page.locator('#stats-body')).toBeVisible()
  // 默认还是柱状图
  await expect(page.locator('#stats-bars')).toBeVisible()

  await page.click('#stats-view-calendar')
  const now = new Date()
  const month = String(now.getFullYear()) + '-' + String(now.getMonth() + 1).padStart(2, '0')
  const today = month + '-' + String(now.getDate()).padStart(2, '0')
  await expect(page.locator('#cal-month')).toHaveText(month)

  // 格子数是 7 的倍数，日期格数与当月天数一致
  const total = await page.locator('#cal-grid .stats-cal-cell').count()
  const dated = await page.locator('#cal-grid .stats-cal-cell[data-day]').count()
  expect(total % 7).toBe(0)
  expect(dated).toBe(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate())
  // 今天那格有记录（色阶 > 0）
  await expect(page.locator('#cal-grid [data-day="' + today + '"]')).toHaveAttribute(
    'data-level',
    /[1-4]/
  )
  // 停在当前月时不能往未来翻
  await expect(page.locator('#cal-next')).toBeDisabled()

  // 翻到上个月：标题变了，能再翻回来
  const before = month
  await page.click('#cal-prev')
  await expect(page.locator('#cal-month')).not.toHaveText(before)
  await expect(page.locator('#cal-next')).toBeEnabled()
  await page.click('#cal-next')
  await expect(page.locator('#cal-month')).toHaveText(before)

  await page.locator('.modal-actions .btn.primary').click()
  await expect(page.locator('.modal')).toHaveCount(0)
})
