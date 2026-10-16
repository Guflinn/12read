import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createOutlinedPdf, createPlainPdf, createScannedPdf } from '../fixtures/pdf'
import { launchApp, makeTempDir, stubOpenDialog, writeBinaryFile } from './helpers'

/**
 * PDF 全链路（0.4.0）：导入 → 书名作者取自 PDF 元数据 → 按自带目录切章 →
 * 正文读得出来（行接成段）→ 没有目录时按页分章 → 扫描件明确报错。
 *
 * 夹具是**运行时从零拼出来的最小 PDF**（`tests/fixtures/pdf.ts`，内置 Helvetica），
 * 所以 e2e 既不依赖用户的书，也不含任何版权内容 —— 仓库里不放任何二进制 PDF。
 */
test.describe.configure({ mode: 'serial' })

let app: ElectronApplication | null = null

async function openApp(dataDir: string): Promise<Page> {
  app = await launchApp(dataDir)
  const page = await app.firstWindow()
  await page.waitForSelector('#btn-import')
  return page
}

async function importFile(page: Page, filePath: string): Promise<void> {
  if (!app) throw new Error('应用未启动')
  await stubOpenDialog(app, [filePath])
  await page.click('#btn-import')
}

test.afterEach(async () => {
  await app?.close()
  app = null
})

test('导入有文字层的 PDF：书名作者来自元数据，按自带目录切章，正文能读', async () => {
  const srcDir = makeTempDir('12read-pdf-src-')
  const file = writeBinaryFile(srcDir, '一个不相干的名字.pdf', createOutlinedPdf())

  const page = await openApp(makeTempDir('12read-pdf-'))
  await importFile(page, file)

  // 书名与作者取自 PDF 的 /Info，文件名不参与
  await expect(page.locator('.book-title')).toHaveText('样张')
  await expect(page.locator('.book-author')).toContainText('测试作者')
  await expect(page.locator('.book-card .cover-badge')).toHaveText('PDF')
  // PDF 没有「编码」这回事，书卡上是「提取」
  await expect(page.locator('.book-card .card-encoding')).toHaveText('提取')

  await page.click('.book-card')
  await expect(page.locator('.chapter-title')).toHaveText('Chapter 1 起风')
  // 跨行的句子接上了，说明段落还原起作用了
  await expect(page.locator('#reader-content')).toContainText('The wind came down from the pass')
  await expect(page.locator('#reader-content')).toContainText('It kept blowing all afternoon, harder and harder.')

  // 目录：两条（自带 /Outlines）
  await page.click('#btn-toc')
  await expect(page.locator('#toc-list li')).toHaveCount(2)
  await expect(page.locator('#toc-list li').nth(1)).toContainText('Chapter 2 落雨')
  await page.click('#toc-list li:nth-child(2)')
  await expect(page.locator('.chapter-title')).toHaveText('Chapter 2 落雨')
  await expect(page.locator('#reader-content')).toContainText('Rain fell on the roof tiles')
})

test('没有目录的 PDF：按页分章（第 N 页）', async () => {
  const srcDir = makeTempDir('12read-pdf-plain-src-')
  const file = writeBinaryFile(srcDir, '两页纸.pdf', createPlainPdf())

  const page = await openApp(makeTempDir('12read-pdf-plain-'))
  await importFile(page, file)

  await expect(page.locator('.book-card')).toHaveCount(1)
  await page.click('.book-card')
  await expect(page.locator('.chapter-title')).toHaveText('第 1 页')
  await expect(page.locator('#reader-content')).toContainText('Only page one has words.')

  await page.click('#btn-toc')
  await expect(page.locator('#toc-list li')).toHaveCount(2)
  await expect(page.locator('#toc-list li').nth(1)).toContainText('第 2 页')
})

test('扫描件的 PDF：明确说扫描件（没有文字层），不建卡片', async () => {
  const srcDir = makeTempDir('12read-pdf-scan-src-')
  const file = writeBinaryFile(srcDir, '扫描版.pdf', createScannedPdf())

  const page = await openApp(makeTempDir('12read-pdf-scan-'))
  await importFile(page, file)

  await expect(page.locator('#errbar')).toContainText('扫描件')
  await expect(page.locator('.book-card')).toHaveCount(0)
  await expect(page.locator('.import-row')).toHaveCount(0)
})

test('坏 PDF：给中文提示而不是崩掉', async () => {
  const srcDir = makeTempDir('12read-pdf-bad-src-')
  const file = writeBinaryFile(srcDir, '坏掉的.pdf', Buffer.from('这不是 PDF', 'utf8'))

  const page = await openApp(makeTempDir('12read-pdf-bad-'))
  await importFile(page, file)

  await expect(page.locator('#errbar')).toContainText('PDF')
  await expect(page.locator('.book-card')).toHaveCount(0)
})

test('PDF 与其它格式共用同一条阅读链路（搜索能命中）', async () => {
  const srcDir = makeTempDir('12read-pdf-search-src-')
  const file = writeBinaryFile(srcDir, '可搜索的.pdf', createOutlinedPdf())

  const page = await openApp(makeTempDir('12read-pdf-search-'))
  await importFile(page, file)
  await page.click('.book-card')

  await page.keyboard.press('Control+f')
  await page.fill('#search-input', 'roof tiles')
  await expect(page.locator('#search-list li').first()).toContainText('roof tiles')
  await page.keyboard.press('Escape')
})
