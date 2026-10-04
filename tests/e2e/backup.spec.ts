import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { buildNovel, launchApp, makeTempDir, stubOpenDialog, stubSaveDialog, writeNovelFile } from './helpers'

// 0.1.3 第 9 项：整库导出成一个 zip（数据库快照 + 原始文件 + 清单）。
test.describe.configure({ mode: 'serial' })

let app: ElectronApplication | null = null

test.afterEach(async () => {
  await app?.close()
  app = null
})

async function openShelf(dataDir: string, sourceDir: string): Promise<Page> {
  writeNovelFile(sourceDir, '备份样书.txt', buildNovel())
  app = await launchApp(dataDir)
  const win = await app.firstWindow()
  await win.waitForSelector('#btn-import')
  await stubOpenDialog(app, [join(sourceDir, '备份样书.txt')])
  await win.click('#btn-import')
  await expect(win.locator('.book-card')).toHaveCount(1)
  return win
}

test('导出备份：选好位置后写出一个能解开的 zip', async () => {
  const targetDir = makeTempDir('12read-backup-out-')
  const zipPath = join(targetDir, '12read-backup.zip')
  const page = await openShelf(makeTempDir('12read-backup-'), makeTempDir('12read-backup-src-'))
  if (!app) throw new Error('应用还没启动')

  await stubSaveDialog(app, zipPath)
  await page.click('#btn-export')
  await expect(page.locator('#toast')).toHaveText(/已导出备份（1 本/, { timeout: 10_000 })

  expect(existsSync(zipPath)).toBe(true)
  const bytes = readFileSync(zipPath)
  // EOCD 签名在最后 22 字节的开头，说明这是个完整收尾的 zip
  expect(bytes.subarray(bytes.length - 22).readUInt32LE(0)).toBe(0x06054b50)
  expect(bytes.includes(Buffer.from('12read-backup.json'))).toBe(true)
  expect(bytes.includes(Buffer.from('library.db'))).toBe(true)
  // 导出按钮复位，还能再点
  await expect(page.locator('#btn-export')).toBeEnabled()
  await expect(page.locator('#btn-export')).toHaveText('导出备份')
})

test('导出备份：用户取消时只提示不写文件', async () => {
  const targetDir = makeTempDir('12read-backup-out2-')
  const zipPath = join(targetDir, '12read-backup.zip')
  const page = await openShelf(makeTempDir('12read-backup2-'), makeTempDir('12read-backup-src2-'))
  if (!app) throw new Error('应用还没启动')

  await stubSaveDialog(app, null)
  await page.click('#btn-export')
  await expect(page.locator('#toast')).toHaveText('已取消导出', { timeout: 10_000 })
  expect(existsSync(zipPath)).toBe(false)
})
