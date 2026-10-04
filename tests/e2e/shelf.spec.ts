import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import * as iconv from 'iconv-lite'
import {
  buildNovel,
  launchApp,
  makeTempDir,
  stubOpenDialog,
  writeBinaryFile,
  writeNovelFile
} from './helpers'

// 书架这一层是 MVP 3.3 的验收面：书名清洗、最近阅读排序、重命名、删除、目录高亮、错误提示。
// serial：每个用例都要独占一棵真实的 Electron 进程。
test.describe.configure({ mode: 'serial' })

let app: ElectronApplication | null = null
let page: Page | null = null

async function openApp(dataDir: string): Promise<Page> {
  app = await launchApp(dataDir)
  const win = await app.firstWindow()
  await win.waitForSelector('#btn-import')
  return win
}

async function importPaths(target: Page, paths: string[]): Promise<void> {
  if (!app) throw new Error('应用还没启动')
  await stubOpenDialog(app, paths)
  await target.click('#btn-import')
}

/** 按书名精确挑卡片（书名互相包含时 hasText 会误伤，所以用 ^…$）。 */
function card(target: Page, title: RegExp) {
  return target.locator('.book-card', { has: target.locator('.book-title', { hasText: title }) })
}

test.afterEach(async () => {
  await app?.close()
  app = null
  page = null
})

test('书架：多选导入清洗书名作者，重命名与删除立即可见', async () => {
  const sourceDir = makeTempDir('12read-shelf-src-')
  writeNovelFile(sourceDir, '《甲书》甲作者.txt', buildNovel())
  writeNovelFile(sourceDir, '乙书(完结).txt', buildNovel())

  page = await openApp(makeTempDir('12read-shelf-'))
  await importPaths(page, [join(sourceDir, '《甲书》甲作者.txt'), join(sourceDir, '乙书(完结).txt')])

  await expect(page.locator('.book-card')).toHaveCount(2)
  // 《书名》作者.txt：书名与作者分开；乙书(完结).txt：只把 (完结) 这类标注清掉
  await expect(card(page, /^甲书$/).locator('.book-title')).toHaveText('甲书')
  await expect(card(page, /^甲书$/).locator('.book-author')).toHaveText('甲作者')
  await expect(card(page, /^乙书$/).locator('.book-title')).toHaveText('乙书')
  await expect(card(page, /^乙书$/).locator('.book-author')).toHaveText(/3 节/)
  await expect(page.locator('.book-title', { hasText: '完结' })).toHaveCount(0)

  // 重命名：走真实 Modal
  await card(page, /^甲书$/).locator('.card-rename').click()
  await expect(page.locator('.modal h3')).toHaveText('重命名')
  await page.locator('.modal input').fill('甲书改名')
  await page.locator('.modal-actions .btn.primary').click()
  await expect(card(page, /^甲书改名$/).locator('.book-title')).toHaveText('甲书改名')
  await expect(page.locator('.modal')).toHaveCount(0)

  // 删除：danger 确认后卡片与正文一起消失
  await card(page, /^乙书$/).locator('.card-delete').click()
  await expect(page.locator('.modal h3')).toHaveText('删除这本书？')
  await page.locator('.modal-actions .btn.danger').click()
  await expect(page.locator('.book-card')).toHaveCount(1)
  await expect(page.locator('.book-title', { hasText: '乙书' })).toHaveCount(0)
})

test('最近阅读：没滚动过就回书架的那本也会排到最前，滚动过的记下百分比', async () => {
  const sourceDir = makeTempDir('12read-shelf-sort-')
  writeNovelFile(sourceDir, '《甲书》甲作者.txt', buildNovel())
  writeNovelFile(sourceDir, '乙书.txt', buildNovel())

  page = await openApp(makeTempDir('12read-shelf-'))
  await importPaths(page, [join(sourceDir, '《甲书》甲作者.txt'), join(sourceDir, '乙书.txt')])
  await expect(page.locator('.book-card')).toHaveCount(2)

  // 打开甲书，一次都不滚动，直接回书架
  await card(page, /^甲书$/).click()
  await expect(page.locator('.chapter-title')).toHaveText('第一章 起点')
  await page.click('#btn-back')
  await expect(page.locator('.book-title').first()).toHaveText('甲书')

  // 再打开乙书并滚动一段，回书架后它排最前且进度不再是 0
  await card(page, /^乙书$/).click()
  await expect(page.locator('.chapter-title')).toHaveText('第一章 起点')
  await page.locator('#reader-scroll').evaluate((el) => {
    el.scrollTop = 900
  })
  await page.waitForTimeout(800)
  await page.click('#btn-back')

  await expect(page.locator('.book-title').first()).toHaveText('乙书')
  await expect(card(page, /^乙书$/).locator('.book-foot')).toHaveText(/已读/)
  const width = await card(page, /^乙书$/)
    .locator('.progress-fill')
    .evaluate((el) => (el as HTMLElement).style.width)
  expect(Number.parseFloat(width)).toBeGreaterThan(0)
})

test('目录抽屉高亮当前章，点章切换，Esc 关掉', async () => {
  const sourceDir = makeTempDir('12read-shelf-toc-')
  writeNovelFile(sourceDir, '目录测试书.txt', buildNovel())

  page = await openApp(makeTempDir('12read-shelf-'))
  await importPaths(page, [join(sourceDir, '目录测试书.txt')])
  await expect(page.locator('.book-card')).toHaveCount(1)
  await card(page, /^目录测试书$/).click()
  await expect(page.locator('.chapter-title')).toHaveText('第一章 起点')

  await page.click('#btn-toc')
  await expect(page.locator('#toc-drawer')).toHaveClass(/on/)
  await expect(page.locator('.toc-list li')).toHaveCount(3)
  await expect(page.locator('.toc-list li.on')).toHaveCount(1)
  await expect(page.locator('.toc-list li.on')).toHaveText(/第一章/)

  await page.locator('.toc-list li').nth(2).click()
  await expect(page.locator('.chapter-title')).toHaveText('第三章 归途')
  await expect(page.locator('#reader-chapter-label')).toHaveText(/3\/3/)

  await page.click('#btn-toc')
  await expect(page.locator('.toc-list li.on')).toHaveText(/第三章/)
  await page.keyboard.press('Escape')
  await expect(page.locator('#toc-drawer')).not.toHaveClass(/on/)
})

test('导入不存在的文件：给中文提示，不留「正在导入」任务，也不建卡片', async () => {
  const dataDir = makeTempDir('12read-shelf-missing-')
  page = await openApp(dataDir)

  await importPaths(page, [join(dataDir, '不存在的书.txt')])

  await expect(page.locator('#errbar')).toContainText('打不开这个文件')
  await expect(page.locator('.import-row')).toHaveCount(0)
  await expect(page.locator('.book-card')).toHaveCount(0)
})

test('书架搜索与排序：搜作者也能命中，进度可排序', async () => {
  const sourceDir = makeTempDir('12read-shelf-filter-')
  writeNovelFile(sourceDir, '《甲书》甲作者.txt', buildNovel())
  writeNovelFile(sourceDir, '乙书.txt', buildNovel())

  page = await openApp(makeTempDir('12read-shelf-'))
  await importPaths(page, [join(sourceDir, '《甲书》甲作者.txt'), join(sourceDir, '乙书.txt')])
  await expect(page.locator('.book-card')).toHaveCount(2)

  // 搜作者也能命中
  await page.fill('#shelf-search', '甲作者')
  await expect(page.locator('.book-card')).toHaveCount(1)
  await expect(page.locator('.book-title')).toHaveText('甲书')
  await expect(page.locator('#shelf-match')).toHaveText('匹配 1 本')

  // 搜不到时给空态
  await page.fill('#shelf-search', '不存在的书')
  await expect(page.locator('.book-card')).toHaveCount(0)
  await expect(page.locator('#shelf-nomatch')).toBeVisible()

  // 清空恢复全部
  await page.fill('#shelf-search', '')
  await expect(page.locator('.book-card')).toHaveCount(2)
  await expect(page.locator('#shelf-match')).toHaveCount(0)

  // 书名排序：甲在乙前
  await page.selectOption('#shelf-sort', 'title')
  await expect(page.locator('.book-title').first()).toHaveText('甲书')
  await expect(page.locator('.book-title').nth(1)).toHaveText('乙书')

  // 进度排序：读过一段的乙书排前面
  await card(page, /^乙书$/).click()
  await expect(page.locator('.chapter-title')).toHaveText('第一章 起点')
  await page.locator('#reader-scroll').evaluate((el) => {
    el.scrollTop = 900
  })
  await page.waitForTimeout(800)
  await page.click('#btn-back')
  await page.selectOption('#shelf-sort', 'progress')
  await expect(page.locator('.book-title').first()).toHaveText('乙书')
})

test('书架左下角显示版本号，进阅读器就不出现', async () => {
  const sourceDir = makeTempDir('12read-version-src-')
  writeNovelFile(sourceDir, '版本书.txt', buildNovel())

  page = await openApp(makeTempDir('12read-version-'))
  if (!app) throw new Error('应用还没启动')
  // 版本号取真实的应用版本，别把 package.json 里的版本抄进断言（一升版就红）
  const version = String(await app.evaluate(({ app: electronApp }) => electronApp.getVersion()))
  expect(version).toMatch(/^\d+\.\d+\.\d+/)

  const label = page.locator('#app-version')
  await expect(label).toHaveText('v' + version)
  await expect(label).toHaveAttribute('title', '十二阅读 ' + version)

  // 钉在窗口左下角：横向落在左半边，纵向贴着底边
  const box = await label.boundingBox()
  const view = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
  if (!box) throw new Error('版本角标没有盒子')
  expect(box.x).toBeLessThan(view.w / 2)
  expect(box.y + box.height).toBeGreaterThan(view.h - 40)

  // 不影响阅读：进了阅读器这个角标就不存在
  await importPaths(page, [join(sourceDir, '版本书.txt')])
  await expect(page.locator('.book-card')).toHaveCount(1)
  await card(page, /^版本书$/).click()
  await expect(page.locator('.chapter-title')).toHaveText('第一章 起点')
  await expect(page.locator('#app-version')).toHaveCount(0)
})

test('重新解码：BIG5 繁体书认成乱码，在书卡上换编码重解一遍', async () => {
  const sourceDir = makeTempDir('12read-big5-src-')
  // 两个章名才会按章节切（只命中一个标记时整本定长分段，见 chapter-split）
  const text =
    '第一章 起点\n' +
    '繁體中文測試，這是一本老書。\n'.repeat(20) +
    '第二章 轉折\n' +
    '繁體中文測試，這是一本老書。\n'.repeat(20)
  const file = writeBinaryFile(sourceDir, '繁体老书.txt', iconv.encode(text, 'big5'))

  page = await openApp(makeTempDir('12read-big5-'))
  await importPaths(page, [file])
  await expect(page.locator('.book-card')).toHaveCount(1)
  await expect(card(page, /^繁体老书$/).locator('.book-title')).toHaveText('繁体老书')

  // 自动检测认不出 BIG5：按可疑放行，正文是乱码，连章名都认不出（退化成按字数分段）
  await card(page, /^繁体老书$/).click()
  await expect(page.locator('.chapter-title')).toHaveText('分段 1')
  await expect(page.locator('#reader-content')).not.toContainText('繁體中文測試')
  await page.click('#btn-back')

  // 书卡上点「编码」，挑 BIG5，确认后重解
  await card(page, /^繁体老书$/).locator('.card-encoding').click()
  await expect(page.locator('.modal h3')).toHaveText('重新解码')
  await page.click('#redecode-big5')
  await page.locator('.modal-actions .btn.primary').click()
  await expect(page.locator('.modal')).toHaveCount(0)

  // 重解后封面角标跟着变成 BIG5
  await expect(card(page, /^繁体老书$/).locator('.cover-badge')).toHaveText('BIG5')

  await card(page, /^繁体老书$/).click()
  await expect(page.locator('.chapter-title')).toHaveText('第一章 起点')
  await expect(page.locator('#reader-content')).toContainText('繁體中文測試')
})
