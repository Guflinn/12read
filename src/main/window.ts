import { BrowserWindow, screen, shell } from 'electron'
import { join } from 'node:path'
import {
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  resolveWindowBounds,
  type WindowState
} from '@shared/core/window-bounds'

const DEV_URL = process.env['ELECTRON_RENDERER_URL']

/**
 * 建主窗口。`state` 是上次关窗时存下的尺寸与位置（0.1.4）：
 * 传 null（首次启动）或存的坐标已失效时，位置交给系统居中 —— 见
 * `resolveWindowBounds` 的三条规则。
 */
export function createMainWindow(state: WindowState | null = null): BrowserWindow {
  // 建窗前取一次屏幕信息：用它判断存下的坐标还在不在某块屏幕上
  // （外接显示器拔掉后，旧坐标可能整块落在屏幕之外）。
  const displays = screen.getAllDisplays().map((display) => display.workArea)
  const resolved = resolveWindowBounds(state, displays)

  const win = new BrowserWindow({
    ...resolved.bounds,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f6f3ed',
    title: '十二阅读',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false
    }
  })

  if (resolved.maximized) win.maximize()

  win.on('ready-to-show', () => win.show())

  // 一律不开新窗口；外链交给系统浏览器，且本版不应有任何外链。
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // 拦截非本地导航（TECH.md 4.2）。
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = DEV_URL ? url.startsWith(DEV_URL) : url.startsWith('file://')
    if (!allowed) event.preventDefault()
  })

  if (DEV_URL) {
    void win.loadURL(DEV_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}
