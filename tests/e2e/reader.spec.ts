import iconv from 'iconv-lite'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
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
