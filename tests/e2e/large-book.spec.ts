import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import {
  buildNovel,
  launchApp,
  makeTempDir,
  stubOpenDialog,
  topParagraphIndex,
  writeNovelFile
} from './helpers'

test.describe.configure({ mode: 'serial' })

/**
 * 大书专项（0.1.3 第 10 项）：一章 30 万字级别的超长章节。
 * 比 5 万字的分块阈值大一个数量级，盯的是「按步展开 + 章节深处还原」这条路径：
 * 打开只挂前 2 万字、往下滚才继续铺、跳/恢复到深处要一次铺到位。
 */
const CHAPTERS = 4
const PARAGRAPHS_PER_CHAPTER = 6200
const FILLER = '山川湖海风雨星辰晨昏四季'.repeat(4)

function buildLongNovel(): string {
  const numerals = ['一', '二', '三', '四', '五', '六']
  const parts: string[] = []
  for (let c = 1; c <= CHAPTERS; c += 1) {
    parts.push('第' + numerals[c - 1] + '章 长章')
    for (let i = 1; i <= PARAGRAPHS_PER_CHAPTER; i += 1) {
      parts.push('第' + c + '章-第' + i + '段 ' + FILLER)
    }
  }
  return parts.join('\n') + '\n'
}

let app: ElectronApplication | null = null

async function openBigBook(): Promise<Page> {
  app = await launchApp(makeTempDir('12read-big-'))
  const page = await app.firstWindow()
  await page.waitForSelector('#btn-import')
  const sourceDir = makeTempDir('12read-big-src-')
  const bookPath = writeNovelFile(sourceDir, '大书.txt', buildLongNovel())
  await stubOpenDialog(app, [bookPath])
  await page.click('#btn-import')
  await expect(page.locator('.book-card')).toHaveCount(1)
  await page.click('.book-card')
  await expect(page.locator('.chapter-title')).toHaveText('第一章 长章')
  await page.waitForSelector('#reader-content p')
  return page
}

/** 滚到章尾：每滚到底触发一次继续加载，直到「继续加载本章剩余内容」消失 */
async function scrollToChapterEnd(page: Page): Promise<{ rounds: number; ms: number }> {
  const started = Date.now()
  let rounds = 0
  for (let i = 0; i < 200; i += 1) {
    if ((await page.getByText('继续加载本章剩余内容').count()) === 0) break
    const before = await page.locator('#reader-content p').count()
    await page.evaluate(() => {
      const el = document.querySelector('#reader-scroll') as HTMLElement | null
      if (el) el.scrollTop = el.scrollHeight
    })
    await page.waitForFunction((n) => document.querySelectorAll('#reader-content p').length > n, before)
    rounds += 1
  }
  return { rounds, ms: Date.now() - started }
}

test.afterEach(async () => {
  await app?.close()
  app = null
})

test('超长章节：先挂 2 万字，滚到底才一步步铺完，切章仍然很快', async () => {
  const page = await openBigBook()

  // 一上来只铺了一小截：段落数远少于整章，并且提示还能继续加载
  const firstChunk = await page.locator('#reader-content p').count()
  expect(firstChunk).toBeGreaterThan(100)
  expect(firstChunk).toBeLessThan(PARAGRAPHS_PER_CHAPTER)
  await expect(page.getByText('继续加载本章剩余内容')).toBeVisible()

  const scrolled = await scrollToChapterEnd(page)
  const allParagraphs = await page.locator('#reader-content p').count()
  console.log('[big] 铺完一章：', scrolled.rounds, '轮', scrolled.ms, 'ms, 段落', allParagraphs)
  expect(scrolled.rounds).toBeGreaterThan(5)
  expect(allParagraphs).toBe(PARAGRAPHS_PER_CHAPTER)
  await expect(page.getByText('继续加载本章剩余内容')).toHaveCount(0)

  const tSwitch = Date.now()
  await page.keyboard.press('Control+ArrowRight')
  await expect(page.locator('.chapter-title')).toHaveText('第二章 长章')
  await page.waitForSelector('#reader-content p')
  console.log('[big] 切章:', Date.now() - tSwitch, 'ms')
  expect(await topParagraphIndex(page)).toBeLessThan(3)
})

test('超长章节：关掉再打开要回到原来的深处（不能停在半路）', async () => {
  const page = await openBigBook()
  const scrolled = await scrollToChapterEnd(page)
  // 停下来一会儿让进度落盘（滚动停止后节流 500ms 写一次，离开时还会再 flush 一次）
  await page.waitForTimeout(1500)
  const deepIndex = await topParagraphIndex(page)
  const paragraphs = await page.locator('#reader-content p').count()
  console.log('[big] 离开处：段落', paragraphs, '视口顶部第', deepIndex, '段, 铺完用了', scrolled.ms, 'ms')
  // 关掉的位置确实在章尾那一带（滚到底后视口顶部离最后一段还有一两百段，属正常）
  expect(deepIndex).toBeGreaterThan(PARAGRAPHS_PER_CHAPTER - 300)

  await page.click('#btn-back')
  await page.waitForSelector('#btn-import')
  await page.waitForTimeout(400)

  const tRestore = Date.now()
  await page.click('.book-card')
  await page.waitForSelector('#reader-content p')
  // 还原要一路把正文铺到原来的位置：允许几秒，但必须真的到那儿
  // （漏了「先铺到位再滚」这一步时，这里会停在第 900 多段）
  await expect
    .poll(() => topParagraphIndex(page), { timeout: 15_000 })
    .toBeGreaterThan(deepIndex - 5)
  console.log('[big] 重开回到原处:', Date.now() - tRestore, 'ms, 段落', await page.locator('#reader-content p').count())
  expect(await page.locator('#reader-content p').count()).toBe(PARAGRAPHS_PER_CHAPTER)
})

test('超长章节：搜索结果跳到章内深处，也要落到那一段', async () => {
  const page = await openBigBook()

  await page.keyboard.press('Control+f')
  await expect(page.locator('#search-panel')).toHaveClass(/on/)
  await page.fill('#search-input', '第1章-第6000段')
  await expect(page.locator('#search-list .anno-row')).toHaveCount(1)
  await page.click('#search-hit-0')

  await expect
    .poll(() => topParagraphIndex(page), { timeout: 15_000 })
    .toBeGreaterThan(5900)
  await expect(page.locator('#reader-content p.hit')).toHaveCount(1)
  await expect(page.locator('#reader-content p.hit')).toContainText('第1章-第6000段')
  console.log('[big] 跳到第 6000 段：段落', await page.locator('#reader-content p').count())
})

test('大书冒烟：三章样书的一整套流程仍可用（回归护栏）', async () => {
  app = await launchApp(makeTempDir('12read-big-smoke-'))
  const page = await app.firstWindow()
  await page.waitForSelector('#btn-import')
  const sourceDir = makeTempDir('12read-big-smoke-src-')
  const bookPath = writeNovelFile(sourceDir, '样书.txt', buildNovel())
  await stubOpenDialog(app, [bookPath])
  await page.click('#btn-import')
  await expect(page.locator('.book-card')).toHaveCount(1)
  await page.click('.book-card')
  await expect(page.locator('.chapter-title')).toHaveText('第一章 起点')
  await page.keyboard.press('Control+ArrowRight')
  await expect(page.locator('.chapter-title')).toHaveText('第二章 转折')
  await page.click('#btn-back')
  await expect(page.locator('.book-card')).toHaveCount(1)
})
