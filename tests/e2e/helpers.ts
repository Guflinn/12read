import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

/** 仓库根目录：playwright 的 cwd 就是根目录 */
export const ROOT = process.cwd()

export function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

export function writeNovelFile(dir: string, name: string, content: string): string {
  const file = join(dir, name)
  writeFileSync(file, content, 'utf8')
  return file
}

export function writeBinaryFile(dir: string, name: string, bytes: Buffer): string {
  const file = join(dir, name)
  writeFileSync(file, bytes)
  return file
}

/**
 * 构造子进程环境：必须清掉 ELECTRON_RUN_AS_NODE，
 * 否则 electron 会退化成普通 node（没有 CDP），playwright 报 'Process failed to launch!'。
 */
function childEnv(dataDir: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'ELECTRON_RUN_AS_NODE') continue
    if (typeof value === 'string') env[key] = value
  }
  env.TWELVE_READ_DATA_DIR = dataDir
  return env
}

/** 启动真实 Electron 应用，数据目录指到临时目录（main 读 TWELVE_READ_DATA_DIR） */
export async function launchApp(dataDir: string): Promise<ElectronApplication> {
  return electron.launch({
    args: [ROOT],
    cwd: ROOT,
    env: childEnv(dataDir)
  })
}

/** 顶掉系统文件选择框：e2e 里直接返回固定路径 */
export async function stubOpenDialog(app: ElectronApplication, filePaths: string[]): Promise<void> {
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: paths
    })) as typeof dialog.showOpenDialog
  }, filePaths)
}

/** 三章、每章 30 段，足够滚动出进度 */
export function buildNovel(): string {
  const filler = '山川湖海风雨星辰晨昏四季'
  const titles = ['第一章 起点', '第二章 转折', '第三章 归途']
  const parts: string[] = []
  titles.forEach((title, ci) => {
    parts.push(title)
    for (let i = 0; i < 30; i += 1) {
      parts.push('第' + (ci + 1) + '章-第' + (i + 1) + '段 ' + filler.repeat(6))
    }
  })
  return parts.join('\n') + '\n'
}

/** 当前停留在视口顶部的正文段落序号（-1 表示没有段落可见） */
export async function topParagraphIndex(page: Page): Promise<number> {
  return page.evaluate(() => {
    const scroll = document.querySelector('#reader-scroll')
    if (!scroll) return -1
    const top = scroll.getBoundingClientRect().top
    const paragraphs = Array.from(document.querySelectorAll('#reader-content p'))
    return paragraphs.findIndex((p) => p.getBoundingClientRect().bottom > top + 4)
  })
}

export async function cssVar(page: Page, name: string): Promise<string> {
  return page.locator('.app').evaluate((el, varName) => {
    return getComputedStyle(el).getPropertyValue(varName).trim()
  }, name)
}
