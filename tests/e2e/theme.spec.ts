import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { buildNovel, launchApp, makeTempDir, stubOpenDialog, writeNovelFile } from './helpers'

// 主题这一层出过一次真实事故：data-theme 挂在内层 .app 上，而 body 的底色/继承色
// 只认 :root 的日间值，于是夜间模式是「浅底 + 深色顶栏 + 深色文字」的花屏。
// 这里把「整页底色」和「文字对比度」都钉死，防止回归。
test.describe.configure({ mode: 'serial' })

let app: ElectronApplication | null = null

async function openApp(dataDir: string): Promise<Page> {
  app = await launchApp(dataDir)
  const page = await app.firstWindow()
  await page.waitForSelector('#btn-import')
  return page
}

test.afterEach(async () => {
  if (app) {
    await app.close()
    app = null
  }
})

function parseRgb(value: string): [number, number, number] {
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value)
  if (!match) throw new Error('不是 rgb 颜色：' + value)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** WCAG 相对亮度对比度 */
function contrast(fg: string, bg: string): number {
  const lum = (value: string): number => {
    const [r, g, b] = parseRgb(value).map((channel) => {
      const c = channel / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x)
  return (a + 0.05) / (b + 0.05)
}

test('夜间模式：整页底色与文字一起变暗，顶栏不再深底深字', async () => {
  const dataDir = makeTempDir('12read-theme-')
  const bookPath = writeNovelFile(makeTempDir('12read-theme-src-'), '主题测试书.txt', buildNovel())
  const page = await openApp(dataDir)

  // 日间基线：整页浅底深字
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'day')
  const day = await page.evaluate(() => ({
    bg: getComputedStyle(document.body).backgroundColor,
    color: getComputedStyle(document.body).color
  }))
  expect(day.bg).toBe('rgb(246, 243, 237)')
  expect(day.color).toBe('rgb(44, 42, 38)')

  await stubOpenDialog(app!, [bookPath])
  await page.click('#btn-import')
  await page.waitForSelector('.book-card')
  await page.click('.book-card')
  await page.waitForSelector('.chapter-title')

  await page.click('#btn-settings')
  await page.click('[data-theme-choice="night"]')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night')
  // 目录抽屉惰性渲染：先打开，列表项才有样式可读
  await page.click('#btn-toc')
  await expect(page.locator('#toc-list li')).toHaveCount(3)
  const night = await page.evaluate(() => {
    const style = (sel: string) => {
      const el = document.querySelector(sel)
      if (!el) throw new Error('缺少元素 ' + sel)
      const s = getComputedStyle(el)
      return { bg: s.backgroundColor, color: s.color }
    }
    return {
      body: style('body'),
      header: style('.reader-top'),
      paragraph: style('#reader-content p'),
      title: style('.chapter-title'),
      listItem: style('.toc-list li')
    }
  })
  // body 与顶栏取同一套夜间变量 —— 花屏的根因就是这两者不一致
  expect(night.body.bg).toBe('rgb(22, 23, 26)')
  expect(night.header.bg).toBe('rgb(22, 23, 26)')
  expect(night.body.color).toBe('rgb(201, 198, 191)')
  expect(night.header.color).toBe(night.paragraph.color)
  expect(contrast(night.header.color, night.header.bg)).toBeGreaterThan(4.5)
  expect(contrast(night.paragraph.color, night.body.bg)).toBeGreaterThan(4.5)
  expect(contrast(night.title.color, night.body.bg)).toBeGreaterThan(4.5)
  expect(contrast(night.listItem.color, night.listItem.bg)).toBeGreaterThan(4.5)

  // 收起目录（Escape 由阅读器接管），否则 scrim 会挡住返回按钮
  await page.keyboard.press('Escape')
  await expect(page.locator('#toc-drawer')).not.toHaveClass(/on/)

  // 回书架：整页底仍是夜间，标题文字同样用夜间色
  await page.click('#btn-back')
  await expect(page.locator('.book-card')).toHaveCount(1)
  const shelf = await page.evaluate(() => ({
    bodyBg: getComputedStyle(document.body).backgroundColor,
    brandColor: getComputedStyle(document.querySelector('.brand h1') as Element).color
  }))
  expect(shelf.bodyBg).toBe('rgb(22, 23, 26)')
  expect(shelf.brandColor).toBe('rgb(201, 198, 191)')

  // 切回日间要能还原
  await page.click('.book-card')
  await page.click('#btn-settings')
  await page.click('[data-theme-choice="day"]')
  await page.keyboard.press('Escape')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'day')
  // body 上有 background .2s 过渡，切换瞬间 computed style 还是中间值，所以轮询等它走完
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor), { timeout: 3000 })
    .toBe('rgb(246, 243, 237)')
})
