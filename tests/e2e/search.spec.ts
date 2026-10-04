import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { buildNovel, launchApp, makeTempDir, stubOpenDialog, writeNovelFile } from './helpers'

test.describe.configure({ mode: 'serial' })

let app: ElectronApplication | null = null

/** 起应用、导入一本三章样书并打开第一章 */
async function openBook(dataDir: string): Promise<Page> {
  app = await launchApp(dataDir)
  const page = await app.firstWindow()
  await page.waitForSelector('#btn-import')
  const sourceDir = makeTempDir('12read-search-src-')
  const bookPath = writeNovelFile(sourceDir, '搜索书.txt', buildNovel())
  await stubOpenDialog(app, [bookPath])
  await page.click('#btn-import')
  await page.click('.book-card')
  await expect(page.locator('.chapter-title')).toHaveText('第一章 起点')
  return page
}

/** Ctrl+F 打开搜索面板并填入关键词（输入防抖 320ms 后自动搜） */
async function searchFor(page: Page, query: string): Promise<void> {
  await page.keyboard.press('Control+f')
  await expect(page.locator('#search-panel')).toHaveClass(/on/)
  await page.fill('#search-input', query)
}

test.afterEach(async () => {
  if (app) {
    await app.close()
    app = null
  }
})

test('全书搜索：每章都有命中，点一条跳到那一段并闪一下', async () => {
  const page = await openBook(makeTempDir('12read-search-'))

  await searchFor(page, '山川')
  // 每章 180 处命中，每章上限 30 条 × 3 章
  await expect(page.locator('#search-list .anno-row')).toHaveCount(90)
  await expect(page.locator('#search-summary')).toHaveText('90 处 · 3 章')
  await expect(page.locator('#search-more')).toContainText('只列出前 90 条')

  // 命中按章号排序：第 31 条落在第二章
  await expect(page.locator('#search-hit-30')).toContainText('2. 第二章 转折')
  await page.click('#search-hit-30')

  await expect(page.locator('.chapter-title')).toHaveText('第二章 转折')
  await expect(page.locator('#reader-content p.hit')).toHaveCount(1)
  await expect(page.locator('#reader-content p.hit')).toContainText('山川')
})

test('切到「本章」范围：只扫当前章，命中变少', async () => {
  const page = await openBook(makeTempDir('12read-search-chapter-'))

  await page.click('#btn-next')
  await expect(page.locator('.chapter-title')).toHaveText('第二章 转折')

  await searchFor(page, '山川')
  await expect(page.locator('#search-summary')).toHaveText('90 处 · 3 章')

  await page.click('#search-scope-chapter')
  await expect(page.locator('#search-list .anno-row')).toHaveCount(30)
  await expect(page.locator('#search-summary')).toHaveText('30 处 · 1 章')

  await page.keyboard.press('Escape')
  await expect(page.locator('#search-panel')).not.toHaveClass(/on/)
})

test('搜不到时给空态；再打开一次输入框是空的', async () => {
  const page = await openBook(makeTempDir('12read-search-empty-'))

  await searchFor(page, '子虚乌有')
  await expect(page.locator('#search-empty')).toContainText('没找到「子虚乌有」')
  await expect(page.locator('#search-list .anno-row')).toHaveCount(0)
  await expect(page.locator('#search-summary')).toHaveText('0 处 · 0 章')

  await page.keyboard.press('Escape')
  await expect(page.locator('#search-panel')).not.toHaveClass(/on/)

  // 上一次的关键词不留在输入框里，免得新一次搜索被旧结果误导
  await page.keyboard.press('Control+f')
  await expect(page.locator('#search-input')).toHaveValue('')
  await expect(page.locator('#search-list .anno-row')).toHaveCount(0)
})
