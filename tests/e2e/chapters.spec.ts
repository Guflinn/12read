import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { buildNovel, launchApp, makeTempDir, stubOpenDialog, writeNovelFile } from './helpers'

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

test('目录里改分章：改名 / 合并 / 拆分，位置都留在原地，重启后还在', async () => {
  const dataDir = makeTempDir('12read-chapters-')
  const bookPath = writeNovelFile(makeTempDir('12read-chapters-src-'), '分章书.txt', buildNovel())

  const page = await openApp(dataDir)
  await importPath(page, bookPath)
  await expect(page.locator('.book-card')).toHaveCount(1)
  await page.click('.book-card')
  await expect(page.locator('.chapter-title')).toHaveText('第一章 起点')
  await expect(page.locator('#reader-chapter-label')).toContainText('1/3 · 第一章 起点')

  // 改名：只换标题，正文与章数都不动
  await page.click('#btn-toc')
  await expect(page.locator('#toc-list li')).toHaveCount(3)
  await page.click('#toc-rename-0')
  await expect(page.locator('.modal h3')).toHaveText('改章节标题')
  await page.fill('#toc-rename-input', '卷一 启程')
  await page.click('.modal-actions .btn.primary')
  await expect(page.locator('#toc-list li').first()).toContainText('卷一 启程')
  await page.keyboard.press('Escape')
  await expect(page.locator('#toc-drawer')).not.toHaveClass(/on/)
  await expect(page.locator('.chapter-title')).toHaveText('卷一 启程')
  await expect(page.locator('#reader-chapter-label')).toContainText('1/3 · 卷一 启程')

  // 拆分：先把视口停在第一章中间，再在当前位置拆
  await page.evaluate(() => {
    const scroll = document.getElementById('reader-scroll')
    if (!scroll) throw new Error('找不到正文容器')
    scroll.scrollTop = Math.floor(scroll.scrollHeight / 2)
    scroll.dispatchEvent(new Event('scroll'))
  })
  await page.waitForTimeout(120)
  await page.click('#btn-split')
  // 拆点在中间，位置落进新拆出的后半章，章数 +1
  await expect(page.locator('#reader-chapter-label')).toContainText('/4 · 卷一 启程（续）')
  await expect(page.locator('.chapter-title')).toHaveText('卷一 启程（续）')
  await page.click('#btn-toc')
  await expect(page.locator('#toc-list li')).toHaveCount(4)
  await expect(page.locator('#toc-list li').nth(1)).toContainText('卷一 启程（续）')

  // 合并：把后半章并回前一章，位置按绝对字符落回第一章
  await page.click('#toc-merge-0')
  await expect(page.locator('#toc-list li')).toHaveCount(3)
  await page.keyboard.press('Escape')
  await expect(page.locator('.chapter-title')).toHaveText('卷一 启程')
  await expect(page.locator('#reader-chapter-label')).toContainText('1/3 · 卷一 启程')

  // 重启后章节表还是改过的样子
  await app?.close()
  app = null
  const page2 = await openApp(dataDir)
  await page2.click('.book-card')
  await expect(page2.locator('.chapter-title')).toHaveText('卷一 启程')
  await page2.click('#btn-toc')
  await expect(page2.locator('#toc-list li')).toHaveCount(3)
  await expect(page2.locator('#toc-list li').first()).toContainText('卷一 启程')
})
