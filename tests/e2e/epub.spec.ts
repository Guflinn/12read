import { copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, makeTempDir, stubOpenDialog } from './helpers'

/**
 * EPUB 全链路（0.2.0）：导入 → 读书名作者 → 按目录切章 → 图片经自定义协议显示 →
 * 重启后进度还在 → 搜索能命中。
 *
 * 夹具是仓库里的 `tests/fixtures/mini.epub` —— **自有内容的迷你 EPUB 3**
 * （三章 + nav + 一张 PNG），所以 e2e 不依赖用户的书、也不含任何版权内容。
 */
test.describe.configure({ mode: 'serial' })

let app: ElectronApplication | null = null

async function openApp(dataDir: string): Promise<Page> {
  app = await launchApp(dataDir)
  const page = await app.firstWindow()
  await page.waitForSelector('#btn-import')
  return page
}

/** 把夹具复制到临时目录并改个名字：验证「书名作者取自文件内容，而不是文件名」。 */
function stageFixture(): string {
  const dir = makeTempDir('12read-epub-src-')
  const target = join(dir, '一个完全不相干的名字.epub')
  copyFileSync(join(process.cwd(), 'tests/fixtures/mini.epub'), target)
  return target
}

async function importFixture(page: Page, filePath: string): Promise<void> {
  if (!app) throw new Error('应用未启动')
  await stubOpenDialog(app, [filePath])
  await page.click('#btn-import')
  await expect(page.locator('.book-card')).toHaveCount(1)
}

test.afterEach(async () => {
  await app?.close()
  app = null
})

test('导入 EPUB：书名作者来自文件、按 nav 切章、图片真的能显示', async () => {
  const page = await openApp(makeTempDir('12read-epub-'))
  await importFixture(page, stageFixture())

  // 文件名是「一个完全不相干的名字.epub」，书名作者必须来自 OPF
  await expect(page.locator('.book-title')).toHaveText('测试样书')
  await expect(page.locator('.book-author')).toContainText('测试作者')
  // 格式要如实反映在界面上（回归：映射层曾把 format 写死成 txt，角标与「提取」入口全失效）
  await expect(page.locator('.book-card .cover-badge')).toHaveText('EPUB')
  await expect(page.locator('.book-card .card-encoding')).toHaveText('提取')

  await page.click('.book-card')
  await expect(page.locator('.chapter-title')).toHaveText('第一章 起风')
  await expect(page.locator('#reader-content')).toContainText('风从山口进来')

  // 目录：nav 里的四条（含嵌套的第二层）
  await page.click('#btn-toc')
  await expect(page.locator('#toc-list li')).toHaveCount(4)
  await expect(page.locator('#toc-list li').nth(2)).toContainText('第二节 独行')
  await page.click('#toc-list li:nth-child(2)')

  // 第二章：正文 + 实体解码（`&amp;` 已解成 &）
  await expect(page.locator('.chapter-title')).toHaveText('第二章 落雨')
  await expect(page.locator('#reader-content')).toContainText('雨是傍晚下的')
  await expect(page.locator('#reader-content')).toContainText('番茄&土豆')

  // 图片在 `#lonely` 锚点之后，属于嵌套的第三条「第二节 独行」
  await page.click('#btn-toc')
  await page.click('#toc-list li:nth-child(3)')
  await expect(page.locator('.chapter-title')).toHaveText('第二节 独行')
  await expect(page.locator('#reader-content')).toContainText('一个人走到巷口')

  const image = page.locator('img.inline-image')
  await expect(image).toHaveCount(1)
  await expect(image).toHaveAttribute('src', /^reader-image:\/\//)
  // 关键一步：图片字节真的取到了（同时验证自定义协议与 CSP 放行）
  expect(await image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true)
})

test('EPUB 的进度、搜索与切章都走同一条链路', async () => {
  const page = await openApp(makeTempDir('12read-epub-flow-'))
  await importFixture(page, stageFixture())
  await page.click('.book-card')
  await expect(page.locator('.chapter-title')).toHaveText('第一章 起风')

  // 切到第三章（目录里有四章，第三是嵌套的「第二节 独行」）→ 回书架 → 重开应当还停在第三章
  await page.click('#btn-next')
  await page.click('#btn-next')
  await page.click('#btn-next')
  await expect(page.locator('.chapter-title')).toHaveText('第三章 天晴')
  await page.click('#btn-back')
  await page.waitForSelector('#btn-import')
  await page.click('.book-card')
  await expect(page.locator('.chapter-title')).toHaveText('第三章 天晴', { timeout: 10_000 })

  // 搜索：命中的是提取后的纯文本
  await page.keyboard.press('Control+f')
  await page.fill('#search-input', '屋檐')
  await expect(page.locator('[id^="search-hit-"]')).toHaveCount(1)
  await expect(page.locator('[id^="search-hit-"]').first()).toContainText('第三章')
})
