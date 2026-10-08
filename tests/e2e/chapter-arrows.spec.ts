import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { buildNovel, launchApp, makeTempDir, stubOpenDialog, writeNovelFile } from './helpers'

/**
 * 两侧切章箭头（0.2.1）：长章节刚打开还没读到下面时，不用滚到底或开目录就能切章。
 * 形态按用户选的方案 A：垂直居中、平时半透明，悬停显形并浮出章节名提示；
 * 第一章/最后一章各自隐藏；「全宽」栏宽下整体隐藏（免得压住正文）。
 */
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

test('两侧箭头：第一章没有上一章、点击切章、悬停提示带章节名', async () => {
  const dataDir = makeTempDir('12read-edge-')
  const bookPath = writeNovelFile(makeTempDir('12read-edge-src-'), '侧箭书.txt', buildNovel())

  const page = await openApp(dataDir)
  await importPath(page, bookPath)
  await page.click('.book-card')
  await expect(page.locator('.chapter-title')).toHaveText('第一章 起点')

  // 第一章：上一章箭头不渲染；下一章箭头的提示指向第二章
  await expect(page.locator('#edge-prev')).toHaveCount(0)
  const next = page.locator('#edge-next')
  await expect(next).toHaveAttribute('data-tip', '下一章：第二章 转折')
  await expect(next).toBeVisible()

  // 核心场景：长章节刚打开、滚动条拖到底，箭头仍然原地可点 —— 不用滚回底部找按钮
  await page.locator('#reader-scroll').evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await expect(next).toBeVisible()
  await next.click()
  await expect(page.locator('.chapter-title')).toHaveText('第二章 转折')

  // 第二章：两侧箭头都在，上一章的提示往回指
  await expect(page.locator('#edge-prev')).toHaveAttribute('data-tip', '上一章：第一章 起点')

  // 走到最后一章：下一章箭头消失，上一章还能点
  await page.locator('#edge-next').click()
  await expect(page.locator('.chapter-title')).toHaveText('第三章 归途')
  await expect(page.locator('#edge-next')).toHaveCount(0)
  await page.locator('#edge-prev').click()
  await expect(page.locator('.chapter-title')).toHaveText('第二章 转折')
})

test('全宽模式下两侧箭头隐藏，换回其它宽度就回来', async () => {
  const dataDir = makeTempDir('12read-edge-full-')
  const bookPath = writeNovelFile(makeTempDir('12read-edge-full-src-'), '全宽书.txt', buildNovel())

  const page = await openApp(dataDir)
  await importPath(page, bookPath)
  await page.click('.book-card')
  await expect(page.locator('.chapter-title')).toHaveText('第一章 起点')
  await expect(page.locator('#edge-next')).toBeVisible()

  // 切「全宽」：两侧没有留白，箭头整体不渲染
  await page.click('#btn-settings')
  await page.click('#width-full')
  await page.keyboard.press('Escape')
  await expect(page.locator('#edge-next')).toHaveCount(0)
  await expect(page.locator('#edge-prev')).toHaveCount(0)

  // 换回「宽」：箭头回来
  await page.click('#btn-settings')
  await page.click('#width-wide')
  await page.keyboard.press('Escape')
  await expect(page.locator('#edge-next')).toBeVisible()
})
