import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { FAKE_PNG, createMobi } from '../fixtures/mobi'
import { launchApp, makeTempDir, stubOpenDialog } from './helpers'

/**
 * MOBI 全链路（0.3.0）：导入 → 书名作者与封面都来自文件本身 → 按翻页标记切章 →
 * 封面与正文插图真的能显示 → 搜索走同一条链路。
 *
 * 夹具是**运行时从零拼出来的** MOBI（见 tests/fixtures/mobi.ts），
 * 所以 e2e 既不依赖用户的书，也不含任何版权内容 —— 仓库里不需要再放一个 .mobi 二进制。
 */
test.describe.configure({ mode: 'serial' })

let app: ElectronApplication | null = null

const MOBI_HTML =
  '<html><body>' +
  '<div align="center"><img recindex="00001"/></div>' +
  '<div><h1>测试小书</h1></div>' +
  '<mbp:pagebreak/>' +
  '<div><h3>第一章 起风</h3><p>风从山口进来，吹动了窗上的旧报纸。</p></div>' +
  '<mbp:pagebreak/>' +
  '<div><h3>第二章 落雨</h3><p>雨落在瓦上，声音密得像有人在低声说话。</p>' +
  '<div><img recindex="00001"/></div></div>' +
  '</body></html>'

async function openApp(dataDir: string): Promise<Page> {
  app = await launchApp(dataDir)
  const page = await app.firstWindow()
  await page.waitForSelector('#btn-import')
  return page
}

/** 把夹具写到临时目录并改个名字：验证「书名作者取自文件内容，而不是文件名」。 */
function stageFixture(): string {
  const dir = makeTempDir('12read-mobi-src-')
  const target = join(dir, '一个完全不相干的名字.mobi')
  writeFileSync(target, createMobi({ html: MOBI_HTML, cover: FAKE_PNG }))
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

test('导入 MOBI：书名作者封面都来自文件、按翻页标记切章、插图真的能显示', async () => {
  const page = await openApp(makeTempDir('12read-mobi-'))
  await importFixture(page, stageFixture())

  // 文件名是「一个完全不相干的名字.mobi」，书名作者必须来自 EXTH
  await expect(page.locator('.book-title')).toHaveText('测试小书')
  await expect(page.locator('.book-author')).toContainText('测试作者')
  await expect(page.locator('.book-card .cover-badge')).toHaveText('MOBI')
  await expect(page.locator('.book-card .card-encoding')).toHaveText('提取')

  // 封面：MOBI 自带的图片记录落成 cover.*，经自定义协议真的取到了字节
  const cover = page.locator('.book-card .cover-img')
  await expect(cover).toHaveAttribute('src', /^reader-image:\/\//)
  expect(await cover.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true)

  await page.click('.book-card')
  await expect(page.locator('.chapter-title')).toHaveText('封面')
  await page.click('#btn-next')
  await expect(page.locator('.chapter-title')).toHaveText('第一章 起风')
  await expect(page.locator('#reader-content')).toContainText('风从山口进来')

  // 目录：三节（封面 / 第一章 / 第二章）
  await page.click('#btn-toc')
  await expect(page.locator('#toc-list li')).toHaveCount(3)
  await expect(page.locator('#toc-list li').nth(2)).toContainText('第二章 落雨')
  await page.click('#toc-list li:nth-child(3)')

  // 正文插图：recindex → 图片记录 → reader-image://
  await expect(page.locator('.chapter-title')).toHaveText('第二章 落雨')
  await expect(page.locator('#reader-content')).toContainText('雨落在瓦上')
  const inline = page.locator('img.inline-image')
  await expect(inline).toHaveCount(1)
  await expect(inline).toHaveAttribute('src', /^reader-image:\/\//)
  expect(await inline.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(
    true
  )
})

test('MOBI 的进度、搜索与切章都走同一条链路', async () => {
  const page = await openApp(makeTempDir('12read-mobi-flow-'))
  await importFixture(page, stageFixture())
  await page.click('.book-card')
  await expect(page.locator('.chapter-title')).toHaveText('封面')

  await page.click('#btn-next')
  await page.click('#btn-next')
  await expect(page.locator('.chapter-title')).toHaveText('第二章 落雨')
  await page.click('#btn-back')
  await page.waitForSelector('#btn-import')
  await page.click('.book-card')
  await expect(page.locator('.chapter-title')).toHaveText('第二章 落雨', { timeout: 10_000 })

  await page.keyboard.press('Control+f')
  await page.fill('#search-input', '屋檐')
  await expect(page.locator('[id^="search-hit-"]')).toHaveCount(0)
  await page.fill('#search-input', '瓦上')
  await expect(page.locator('[id^="search-hit-"]')).toHaveCount(1)
  await expect(page.locator('[id^="search-hit-"]').first()).toContainText('第二章')
})
