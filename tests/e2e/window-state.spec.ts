import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, makeTempDir } from './helpers'

test.describe.configure({ mode: 'serial' })

interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

let app: ElectronApplication | null = null

async function openApp(dataDir: string): Promise<Page> {
  app = await launchApp(dataDir)
  const page = await app.firstWindow()
  await page.waitForSelector('#btn-import')
  return page
}

async function closeApp(): Promise<void> {
  if (!app) return
  await app.close()
  app = null
}

/**
 * 与窗口打交道的动作都放在模块级函数里：写成 test 体内的内联 `app.evaluate(...)` 时，
 * `app = null` 之后控制流收窄会把它判成 never（TS2339）。
 */
async function windowBounds(): Promise<Bounds> {
  if (!app) throw new Error('应用未启动')
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) throw new Error('没有窗口')
    // 「还原后」的尺寸与位置：最大化时也给还原尺寸，正是我们要存的东西
    return win.getNormalBounds()
  })
}

async function setWindowBounds(bounds: Bounds): Promise<void> {
  if (!app) throw new Error('应用未启动')
  await app.evaluate(({ BrowserWindow }, next) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) throw new Error('没有窗口')
    win.setBounds(next)
  }, bounds)
}

/** 最大化并返回是否真的最大化了（无桌面会话的环境里可能做不到）。 */
async function maximize(): Promise<boolean> {
  if (!app) throw new Error('应用未启动')
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) throw new Error('没有窗口')
    win.maximize()
    return win.isMaximized()
  })
}

async function isMaximized(): Promise<boolean> {
  if (!app) throw new Error('应用未启动')
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) throw new Error('没有窗口')
    return win.isMaximized()
  })
}

test.afterEach(closeApp)

test('窗口尺寸与位置：调过大小后重开还在原处（0.1.4 第 1 项）', async () => {
  const dataDir = makeTempDir('12read-ws-')

  await openApp(dataDir)
  await setWindowBounds({ x: 90, y: 70, width: 980, height: 660 })
  const before = await windowBounds()

  // 关掉再开：数据目录相同，窗口状态存在同一个库里
  await closeApp()
  await openApp(dataDir)
  const after = await windowBounds()

  expect(after.width).toBe(before.width)
  expect(after.height).toBe(before.height)
  // 位置容差几像素：个别窗口管理器会自行微调
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(4)
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(4)
  // 关键：确实恢复了调过的尺寸，而不是退回默认值
  expect(after.width).not.toBe(1180)
  expect(after.height).not.toBe(800)
})

test('最大化状态：最大化下关窗，重开仍是最大化', async () => {
  const dataDir = makeTempDir('12read-ws-max-')

  await openApp(dataDir)
  const maximized = await maximize()
  test.skip(!maximized, '当前环境不支持最大化窗口（无桌面会话时常见）')

  await closeApp()
  await openApp(dataDir)
  expect(await isMaximized()).toBe(true)
})
