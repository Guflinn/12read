import iconv from 'iconv-lite'
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import {
  buildNovel,
  cssVar,
  launchApp,
  makeTempDir,
  stubOpenDialog,
  topParagraphIndex,
  writeBinaryFile,
  writeNovelFile
} from './helpers'

test.describe.configure({ mode: 'serial' })

let app: ElectronApplication | null = null

async function openApp(dataDir: string): Promise<Page> {
  app = await launchApp(dataDir)
  const page = await app.firstWindow()
  await page.waitForSelector('#btn-import')
  return page
}

async function importPath(page: Page, filePath: string): Promise<void> {
  if (!app) throw new Error('应用未启动')
  await stubOpenDialog(app, [filePath])
  await page.click('#btn-import')
}

test.afterEach(async () => {
  if (app) {
    await app.close()
    app = null
  }
})

test('键盘翻页：空格 / PageDown / PageUp / Home / End', async () => {
  const dataDir = makeTempDir('12read-keys-')
  const bookPath = writeNovelFile(makeTempDir('12read-key-src-'), '键盘书.txt', buildNovel())

  const page = await openApp(dataDir)
  await importPath(page, bookPath)
  await page.click('.book-card')
  await expect(page.locator('.chapter-title')).toHaveText('第一章 起点')
  expect(await topParagraphIndex(page)).toBe(0)

  // End 到章尾、Home 回章首
  await page.keyboard.press('End')
  const atEnd = await topParagraphIndex(page)
  expect(atEnd).toBeGreaterThan(3)
  await page.keyboard.press('Home')
  expect(await topParagraphIndex(page)).toBe(0)

  // PageDown 走一屏，但到不了章尾；空格再往下
  await page.keyboard.press('PageDown')
  const afterPageDown = await topParagraphIndex(page)
  expect(afterPageDown).toBeGreaterThan(0)
  expect(afterPageDown).toBeLessThan(atEnd)

  await page.keyboard.press('Space')
  const afterSpace = await topParagraphIndex(page)
  expect(afterSpace).toBeGreaterThan(afterPageDown)

  // Shift+空格往回翻
  await page.keyboard.press('Shift+Space')
  expect(await topParagraphIndex(page)).toBeLessThan(afterSpace)

  // 停在章尾再按翻页键不越界、不报错
  await page.keyboard.press('End')
  const bottom = await topParagraphIndex(page)
  await page.keyboard.press('PageDown')
  await page.keyboard.press('Space')
  expect(await topParagraphIndex(page)).toBeGreaterThanOrEqual(bottom)
})

test('导入 → 阅读 → 切章 → 改字号 → 重启后回到原处', async () => {
  const dataDir = makeTempDir('12read-data-')
  const bookPath = writeNovelFile(makeTempDir('12read-src-'), '《测试书》测试作者.txt', buildNovel())

  let page = await openApp(dataDir)
  await importPath(page, bookPath)

  // 书架：文件名清洗出书名/作者
  await expect(page.locator('.book-card')).toHaveCount(1)
  await expect(page.locator('.book-title')).toHaveText('测试书')
  await expect(page.locator('.book-author')).toHaveText('测试作者')

  // 阅读器：默认第一章
  await page.click('.book-card')
  await expect(page.locator('#reader-book')).toHaveText('测试书')
  await expect(page.locator('.chapter-title')).toHaveText('第一章 起点')
  await expect(page.locator('#reader-chapter-label')).toContainText('1/3')

  // 目录是惰性渲染的：抽屉没打开时一条都不渲染
  await expect(page.locator('#toc-list li')).toHaveCount(0)

  // 目录切到第三章
  await page.click('#btn-toc')
  await expect(page.locator('#toc-list li')).toHaveCount(3)
  await page.click('#toc-list li:nth-child(3)')
  await expect(page.locator('.chapter-title')).toHaveText('第三章 归途')

  // 字号 +1、切夜间
  const fsBefore = await cssVar(page, '--fs')
  await page.click('#btn-settings')
  await expect(page.locator('#settings-sheet')).toHaveClass(/on/)
  await page.click('#fs-plus')
  const fsAfter = await cssVar(page, '--fs')
  expect(parseInt(fsAfter, 10)).toBe(parseInt(fsBefore, 10) + 1)
  await page.click('[data-theme-choice="night"]')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night')
  await page.keyboard.press('Escape')
  await expect(page.locator('#settings-sheet')).not.toHaveClass(/on/)

  // 滚一段，等 500ms 节流落盘
  await page.locator('#reader-scroll').evaluate((el) => {
    el.scrollTop = 900
  })
  await page.waitForTimeout(900)
  const topBefore = await topParagraphIndex(page)
  expect(topBefore).toBeGreaterThan(0)
  const fill = await page.locator('#reader-progress-fill').evaluate((el) => (el as HTMLElement).style.width)
  expect(parseFloat(fill)).toBeGreaterThan(0)

  // 重启，检查章节 / 主题 / 字号 / 位置
  await app!.close()
  app = null
  page = await openApp(dataDir)
  await expect(page.locator('.book-card')).toHaveCount(1)
  await page.click('.book-card')
  await expect(page.locator('.chapter-title')).toHaveText('第三章 归途')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night')
  expect(await cssVar(page, '--fs')).toBe(fsAfter)
  await page.waitForTimeout(400)
  const topAfter = await topParagraphIndex(page)
  expect(Math.abs(topAfter - topBefore)).toBeLessThanOrEqual(1)

  // 回书架能看到已读进度
  await page.click('#btn-back')
  await expect(page.locator('.book-card')).toHaveCount(1)
  await expect(page.locator('.book-foot')).toContainText('已读')
  const shelfFill = await page.locator('.progress-fill').evaluate((el) => (el as HTMLElement).style.width)
  expect(parseFloat(shelfFill)).toBeGreaterThan(0)
})

test('GBK 文件不乱码', async () => {
  const dataDir = makeTempDir('12read-data-')
  const content =
    '第一章 山海\n' +
    '山海之间有大风。'.repeat(20) +
    '\n第二章 星辰\n' +
    '星辰之下有人间。'.repeat(20) +
    '\n'
  const bookPath = writeBinaryFile(makeTempDir('12read-src-'), 'gbk小说.txt', iconv.encode(content, 'gb18030'))

  const page = await openApp(dataDir)
  await importPath(page, bookPath)
  await expect(page.locator('.book-card')).toHaveCount(1)
  await page.click('.book-card')
  await expect(page.locator('.chapter-title')).toHaveText('第一章 山海')

  const text = await page.locator('#reader-content').innerText()
  expect(text).not.toContain('\uFFFD')
  expect(text).toContain('山海之间有大风。')
})

test('二进制文件被挡在门外并给出提示', async () => {
  const dataDir = makeTempDir('12read-data-')
  const bytes = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(128, 0),
    Buffer.from([0x00, 0x01, 0x02, 0x03])
  ])
  const bookPath = writeBinaryFile(makeTempDir('12read-src-'), '伪装.txt', bytes)

  const page = await openApp(dataDir)
  await importPath(page, bookPath)
  await expect(page.locator('#errbar')).toContainText('不是一个纯文本文件')
  await expect(page.locator('.book-card')).toHaveCount(0)
})

/** 从「已读 12.3% · 剩余 456 字 / 1.2 万字」里抠出剩余字数。 */
async function readRemaining(meter: Locator): Promise<number> {
  const text = await meter.innerText()
  // 注意：formatChars 的数字和单位之间有一个空格（"7374 字" / "6.2 万字"）
  const match = text.match(/剩余 ([\d.]+) ?(万)?字/)
  if (!match) return -1
  const value = Number(match[1])
  return match[2] ? value * 10000 : value
}

test('阅读器底部显示已读百分比与剩余字数，往下读一起变', async () => {
  const dataDir = makeTempDir('12read-meter-')
  const bookPath = writeNovelFile(makeTempDir('12read-meter-src-'), '测量书.txt', buildNovel())

  const page = await openApp(dataDir)
  await importPath(page, bookPath)
  await page.click('.book-card')
  await expect(page.locator('.chapter-title')).toHaveText('第一章 起点')

  const meter = page.locator('#reader-meter')
  await expect(meter).toHaveText('已读 0.0% · 剩余 7374 字')
  const before = await readRemaining(meter)
  expect(before).toBeGreaterThan(0)

  // 翻到章尾：进度往前走，剩余字数跟着变少
  await page.keyboard.press('End')
  await expect.poll(() => readRemaining(meter)).toBeLessThan(before)
  await expect(meter).toContainText('已读 ')

  // 回章首又还原
  await page.keyboard.press('Home')
  await expect.poll(() => readRemaining(meter)).toBe(before)
})

test('回到上次位置：停稳后点一下就回去，再点一下回到刚才那里', async () => {
  const dataDir = makeTempDir('12read-bookmark-')
  const bookPath = writeNovelFile(makeTempDir('12read-bookmark-src-'), '位置书.txt', buildNovel())

  const page = await openApp(dataDir)
  await importPath(page, bookPath)
  await page.click('.book-card')
  await expect(page.locator('.chapter-title')).toHaveText('第一章 起点')

  // 打开就记了一个位置，按钮一进来就能点
  const back = page.locator('#btn-pos-back')
  await expect(back).toBeEnabled()
  await expect(back).toContainText('上次位置')

  // 翻到章尾，停够 BOOKMARK_REST_MS，这里就成了「上次停留的位置」
  await page.keyboard.press('End')
  await page.waitForTimeout(1500)
  const atEnd = await topParagraphIndex(page)
  expect(atEnd).toBeGreaterThan(3)

  // 滑回章首，趁还没停稳点「上次位置」→ 回到刚才停稳的地方
  await page.locator('#reader-scroll').evaluate((el) => {
    el.scrollTop = 0
  })
  await back.click()
  await expect.poll(() => topParagraphIndex(page)).toBeGreaterThanOrEqual(atEnd - 2)

  // 再点一次 → 回到刚才离开的地方（章首）
  await back.click()
  await expect.poll(() => topParagraphIndex(page)).toBeLessThanOrEqual(1)
})

test('字重开关：设置里点加粗，正文变粗并且重启后还记着', async () => {
  const dataDir = makeTempDir('12read-bold-')
  const bookPath = writeNovelFile(makeTempDir('12read-bold-src-'), '字重书.txt', buildNovel())

  let page = await openApp(dataDir)
  await importPath(page, bookPath)
  await page.click('.book-card')
  await expect(page.locator('.chapter-title')).toHaveText('第一章 起点')

  const weight = (): Promise<string> =>
    page.locator('#reader-content p').first().evaluate((el) => getComputedStyle(el).fontWeight)
  expect(await weight()).toBe('400')

  await page.click('#btn-settings')
  await expect(page.locator('#settings-sheet')).toHaveClass(/on/)
  await page.click('#bold-on')
  await expect.poll(weight).toBe('600')
  await expect(page.locator('#bold-on')).toHaveClass(/on/)
  await page.click('#bold-off')
  await expect.poll(weight).toBe('400')
  await page.click('#bold-on')
  await expect.poll(weight).toBe('600')
  await page.keyboard.press('Escape')
  expect(await cssVar(page, '--fw')).toBe('600')

  // 重启后还记着加粗
  await app!.close()
  app = null
  page = await openApp(dataDir)
  await page.click('.book-card')
  await expect.poll(weight).toBe('600')
  await page.click('#btn-settings')
  await expect(page.locator('#bold-on')).toHaveClass(/on/)
})


