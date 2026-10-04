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

/**
 * 在第一个正文段落里程序化选中一段文字，再补一次冒泡的 mouseup 让工具条浮出来。
 * 段落里的正文被切成了 span，所以要往下钻到文本节点，按字符偏移选才准。
 */
async function selectParagraphText(page: Page, from: number, to: number): Promise<string> {
  return page.evaluate(
    ({ from, to }) => {
      const paragraph = document.querySelector('#reader-content p[data-offset]')
      const node = paragraph?.querySelector('span')?.firstChild ?? paragraph?.firstChild
      if (!paragraph || !node) return ''
      const range = document.createRange()
      range.setStart(node, from)
      range.setEnd(node, to)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      return selection ? selection.toString() : ''
    },
    { from, to }
  )
}

test.afterEach(async () => {
  if (app) {
    await app.close()
    app = null
  }
})

test('书签：记一个、抽屉里看得见、点它跳回原处、再删掉', async () => {
  const dataDir = makeTempDir('12read-bm-')
  const bookPath = writeNovelFile(makeTempDir('12read-bm-src-'), '书签书.txt', buildNovel())

  const page = await openApp(dataDir)
  await importPath(page, bookPath)
  await page.click('.book-card')
  await expect(page.locator('.chapter-title')).toHaveText('第一章 起点')

  // 往下翻两屏再记书签，确保书签不在章首
  await page.keyboard.press('PageDown')
  await page.keyboard.press('PageDown')
  const marked = await topParagraphIndex(page)
  expect(marked).toBeGreaterThan(0)
  await page.click('#btn-bookmark')

  // 抽屉里的「书签」页能看到这一条：章号 + 摘要
  await page.click('#btn-toc')
  await page.click('#toc-tab-bookmarks')
  await expect(page.locator('#bookmark-list .anno-row')).toHaveCount(1)
  await expect(page.locator('#bookmark-list .anno-pos')).toContainText('1. 第一章 起点')
  await expect(page.locator('#bookmark-list .anno-text')).not.toBeEmpty()

  // 回章首，点书签跳回刚才那一段；抽屉自动关上
  await page.keyboard.press('Home')
  expect(await topParagraphIndex(page)).toBe(0)
  await page.click('#bookmark-list .anno-main')
  await expect(page.locator('#toc-list')).toHaveCount(0)
  await expect.poll(() => topParagraphIndex(page)).toBe(marked)

  // 删掉之后变成空态，并给一次提示
  await page.click('#btn-toc')
  await page.click('#toc-tab-bookmarks')
  await expect(page.locator('#bookmark-list .anno-row')).toHaveCount(1)
  await page.click('#bookmark-list .toc-btn')
  await expect(page.locator('#bookmark-empty')).toBeVisible()
  await expect(page.locator('#toast')).toHaveText('已删除书签')
})

test('划线：选中正文划线、重开应用还在、点一下能删掉', async () => {
  const dataDir = makeTempDir('12read-hl-')
  const bookPath = writeNovelFile(makeTempDir('12read-hl-src-'), '划线书.txt', buildNovel())

  let page = await openApp(dataDir)
  await importPath(page, bookPath)
  await page.click('.book-card')
  await expect(page.locator('.chapter-title')).toHaveText('第一章 起点')

  // 选中第一个段落里的一小段字 → 工具条浮出 → 点「划线」
  const selected = await selectParagraphText(page, 4, 12)
  expect(selected.length).toBeGreaterThan(0)
  await expect(page.locator('#hl-toolbar')).toBeVisible()
  await page.click('#btn-hl-add')

  const marks = page.locator('#reader-content mark.hl')
  await expect(marks).toHaveCount(1)
  await expect(marks).toHaveText(selected)
  await expect(page.locator('#toast')).toHaveText('已划线')

  // 抽屉「划线」页里能看到划下来的原文
  await page.click('#btn-toc')
  await page.click('#toc-tab-highlights')
  await expect(page.locator('#highlight-list .anno-row')).toHaveCount(1)
  await expect(page.locator('#highlight-list .anno-text')).toHaveText(selected)
  // 抽屉开着时顶栏被盖住，用 Esc 关（这也是给用户的那条路）
  await page.keyboard.press('Escape')
  await expect(page.locator('#toc-list')).toHaveCount(0)

  // 重开应用：划线已经落库，回到同一章还是画的
  await app?.close()
  app = null
  page = await openApp(dataDir)
  await page.click('.book-card')
  await expect(page.locator('.chapter-title')).toHaveText('第一章 起点')
  await expect(page.locator('#reader-content mark.hl')).toHaveText(selected)

  // 点在已有划线上浮出「删除划线」，删掉后正文不再有标记
  await page.locator('#reader-content mark.hl').click()
  await expect(page.locator('#btn-hl-remove')).toBeVisible()
  await page.click('#btn-hl-remove')
  await expect(page.locator('#reader-content mark.hl')).toHaveCount(0)
  await expect(page.locator('#toast')).toHaveText('已删除划线')
})
