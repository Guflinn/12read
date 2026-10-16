import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, makeTempDir, stubOpenDialog, writeNovelFile } from './helpers'

/**
 * Markdown 全链路（0.4.0）：导入 → 书名取 `#` 标题 → 按 `##` 切章 →
 * 标记藏起来但原文一个字符都不少 → 代码块 / 列表 / 链接渲染 → 搜索照样命中。
 *
 * 这里最关键的一条断言是「段落 textContent 拼起来 = 原始正文」：
 * 进度、书签、划线、搜索全都锚在「原始文本的 UTF-16 偏移」上，
 * 渲染层只要偷偷删掉或插入一个字，偏移就整体错位（见 core/markdown.ts 的注释）。
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
  await expect(page.locator('.book-card')).toHaveCount(1)
}

/** 有标题结构、有列表与代码块的笔记（自有内容，无版权问题）。 */
const NOTE = [
  '# 读书笔记',
  '',
  '## 第一章 起手',
  '',
  '正文里有 **粗体** 与 `代码`，还有 [链接](https://example.com)。',
  '',
  '- 一条清单',
  '- 另一条',
  '',
  '```js',
  'const a = 1',
  '# 代码里的井号不是标题',
  '```',
  '',
  '## 第二章 收束',
  '',
  '结尾。',
  '',
  '---',
  '',
  '最后一段。',
  ''
].join('\n')

test.afterEach(async () => {
  await app?.close()
  app = null
})

test('导入 .md：书名取一级标题、按二级标题切章、标记藏起来而原文保持不变', async () => {
  const srcDir = makeTempDir('12read-md-src-')
  // 文件名故意与书名无关：书名应当取自文件里的 `# 读书笔记`
  const file = writeNovelFile(srcDir, '完全不相干的文件名.md', NOTE)

  const page = await openApp(makeTempDir('12read-md-'))
  await importPath(page, file)

  // 书名来自文件内容；格式如实反映在角标上，MD 是纯文本 → 书卡上是「编码」
  await expect(page.locator('.book-title')).toHaveText('读书笔记')
  await expect(page.locator('.book-card .cover-badge')).toHaveText('MD')
  await expect(page.locator('.book-card .card-encoding')).toHaveText('编码')

  await page.click('.book-card')
  // 书开在第一章「开篇」：`# 读书笔记` 落在正文里，按一级标题渲染（章名是「开篇」，不去重）
  await expect(page.locator('.chapter-title')).toHaveText('开篇')
  const h1 = page.locator('#reader-content p.md-h1')
  await expect(h1).toHaveAttribute('data-offset', '0')
  const heading = await h1.evaluate((el) => ({
    visible: (el as HTMLElement).innerText,
    raw: el.textContent
  }))
  expect(heading.visible).toBe('读书笔记')
  expect(heading.raw).toBe('# 读书笔记')
  await expect(page.locator('#reader-content .md-syntax').first()).toBeHidden()

  // 跳到第一章：章名 = 标题行的文字（`##` 不算），且正文里不再重复显示这一行
  await page.click('#btn-toc')
  await expect(page.locator('#toc-list li')).toHaveCount(3)
  await expect(page.locator('#toc-list li').nth(1)).toContainText('第一章 起手')
  await page.click('#toc-list li:nth-child(2)')
  await expect(page.locator('.chapter-title')).toHaveText('第一章 起手')
  await expect(page.locator('#reader-content .md-heading')).toHaveCount(0)
  // 正文是异步读进来的：先等第一段真的挂上，再去数段落
  await expect(page.locator('#reader-content p[data-offset]').first()).toContainText('正文里有')

  // ① 原文一个字符都不少（含 `**`、反引号、代码围栏）—— 只把 `&nbsp;` 的占位空行还原成空串。
  //    空行段落没有 data-offset，所以这里挑到的就是「有内容的那些行」。
  const raw = await page.locator('#reader-content p[data-offset]').evaluateAll((els) =>
    els.map((el) => (el.textContent === '\u00A0' ? '' : el.textContent)).join('\n')
  )
  expect(raw).toBe(
    [
      '正文里有 **粗体** 与 `代码`，还有 [链接](https://example.com)。',
      '- 一条清单',
      '- 另一条',
      '```js',
      'const a = 1',
      '# 代码里的井号不是标题',
      '```'
    ].join('\n')
  )

  // ② 可见文字里没有标记（innerText 不含 display:none 的内容）
  const visible = await page.locator('#reader-content').evaluate((el) => (el as HTMLElement).innerText)
  expect(visible).toContain('正文里有 粗体 与 代码，还有 链接。')
  expect(visible).not.toContain('**')
  expect(visible).not.toContain('##')

  // ③ 行内与块级都按样渲染
  await expect(page.locator('#reader-content strong.md-strong')).toHaveText('粗体')
  await expect(page.locator('#reader-content code.md-code-inline')).toHaveText('代码')
  await expect(page.locator('#reader-content .md-link')).toHaveAttribute('title', 'https://example.com')
  await expect(page.locator('#reader-content p.md-ul')).toHaveCount(2)
  // 圆点是 CSS 画的（不进 DOM 文字），所以**看得见的**文字里没有 `-`
  // （toHaveText 读的是 textContent，会把藏起来的标记也读进来，所以这里必须用 innerText）
  const listText = await page
    .locator('#reader-content p.md-ul')
    .first()
    .evaluate((el) => (el as HTMLElement).innerText)
  expect(listText).toBe('一条清单')

  // ④ 代码块：两行正文 + 两行围栏；围栏行是空的（height 0），`#` 开头那行没被当成标题
  await expect(page.locator('#reader-content p.md-code')).toHaveCount(2)
  await expect(page.locator('#reader-content p.md-code').first()).toHaveClass(/md-code-first/)
  await expect(page.locator('#reader-content p.md-code').last()).toHaveClass(/md-code-last/)
  await expect(page.locator('#reader-content p.md-fence')).toHaveCount(2)
  await expect(page.locator('#reader-content p.md-fence').first()).toBeHidden()
  await expect(page.locator('#reader-content .md-heading')).toHaveCount(0)

  // ⑤ 第二章：分隔线整行藏起来，线由 CSS 画
  await page.click('#btn-toc')
  await page.click('#toc-list li:nth-child(3)')
  await expect(page.locator('.chapter-title')).toHaveText('第二章 收束')
  await expect(page.locator('#reader-content p.md-rule')).toHaveCount(1)

  // ⑥ 搜索搜的是**原始正文**：命中上下文里能看到标记（这是有意为之，见 CHANGELOG 0.4.0）
  await page.keyboard.press('Control+f')
  await page.fill('#search-input', '粗体')
  await expect(page.locator('#search-list li').first()).toContainText('粗体')
  await page.keyboard.press('Escape')
})

test('没有标题结构的 .md：退回定长分段，书名用文件名', async () => {
  const srcDir = makeTempDir('12read-md-plain-src-')
  const file = writeNovelFile(srcDir, '普通笔记.md', '就是一段没有标题的笔记。'.repeat(40))

  const page = await openApp(makeTempDir('12read-md-plain-'))
  await importPath(page, file)

  await expect(page.locator('.book-title')).toHaveText('普通笔记')
  await page.click('.book-card')
  await expect(page.locator('.chapter-title')).toHaveText('分段 1')
  await expect(page.locator('#reader-content')).toContainText('没有标题的笔记')
})
