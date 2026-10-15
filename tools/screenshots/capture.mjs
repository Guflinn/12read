/**
 * 生成 README 用的界面截图（预览图/）。
 *
 * 流程：启动 release 里的免安装版 exe（与发布版同一份程序），
 * 数据目录指到临时目录（TWELVE_READ_DATA_DIR，不碰真实书库），
 * 导入 tools/screenshots/make-demo-books.py 生成的公版演示书，
 * 依次截书架、阅读器、排版面板、目录抽屉、夜间模式。
 *
 * 用法：
 *   python tools/screenshots/make-demo-books.py <演示书目录>
 *   node tools/screenshots/capture.mjs <演示书目录>
 *
 * 注意：
 *   - 进程环境里的 ELECTRON_RUN_AS_NODE 必须清掉，否则 electron 退化成普通 node。
 *   - cwd 必须是 Windows 真实路径（Git-Bash 的 /tmp 会让 crashpad 直接退出）。
 */

import { mkdirSync, mkdtempSync } from 'node:fs'
import { readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from '@playwright/test'

const ROOT = resolve(import.meta.dirname, '../..')
const BOOKS_DIR = resolve(process.argv[2] ?? '.')
const OUT_DIR = join(ROOT, '预览图')
/** 与 e2e 相同：受限环境（沙箱/无 GPU）下需要 --no-sandbox --disable-gpu */
const EXTRA_ARGS = (process.env.TWELVE_READ_E2E_ELECTRON_ARGS ?? '')
  .split(/\s+/)
  .filter((s) => s.length > 0)

const shot = async (page, name) => {
  await page.screenshot({ path: join(OUT_DIR, name) })
  console.log('已截：', name)
}

const card = (page, title) =>
  page.locator('.book-card', { has: page.locator('.book-title', { hasText: title }) })

const dataDir = mkdtempSync(join(tmpdir(), '12read-shots-'))
mkdirSync(OUT_DIR, { recursive: true })

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
env.TWELVE_READ_DATA_DIR = dataDir

const app = await electron.launch({
  args: [ROOT, ...EXTRA_ARGS],
  cwd: ROOT,
  env
})

try {
  const page = await app.firstWindow()
  await page.waitForSelector('#btn-import')

  // 窗口放大到 1440x920（DPR 1.5 下截图为 2160x1380 物理像素）
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setSize(1440, 920)
    win.center()
  })
  await page.waitForTimeout(600)

  // 导入演示书
  const bookPaths = readdirSync(BOOKS_DIR)
    .filter((f) => /\.(txt|epub)$/i.test(f))
    .map((f) => join(BOOKS_DIR, f))
  if (bookPaths.length === 0) throw new Error('演示书目录为空：' + BOOKS_DIR)
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths })
  }, bookPaths)
  await page.click('#btn-import')
  await page.waitForSelector('.book-card')
  await page.waitForFunction(() => document.querySelectorAll('.book-card').length >= 3)
  await page.waitForTimeout(800)

  // 打开《呐喊》翻到第四章《故乡》：文字饱满，也给书架卡片攒出真实进度
  await card(page, '呐喊').click()
  await page.waitForSelector('.chapter-title')
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press('Control+ArrowRight')
    await page.waitForTimeout(400)
  }
  await page.waitForTimeout(2000)

  await shot(page, '02-阅读器-日间.png')

  // 排版面板（Aa）
  await page.click('#btn-settings')
  await page.waitForTimeout(500)
  await shot(page, '03-排版面板.png')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  // 目录抽屉
  await page.click('#btn-toc')
  await page.waitForTimeout(500)
  await shot(page, '04-目录抽屉.png')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  // 夜间模式
  await page.click('#btn-theme')
  await page.waitForTimeout(600)
  await shot(page, '05-阅读器-夜间.png')

  // 切回日间再回书架：卡片带真实进度，头图用日间
  await page.click('#btn-theme')
  await page.waitForTimeout(600)
  await page.click('#btn-back')
  await page.waitForSelector('.book-card')
  await page.waitForTimeout(800)
  await shot(page, '01-书架.png')

  await app.close()
  console.log('完成。截图在', OUT_DIR)
} catch (err) {
  await app.close()
  throw err
}
