import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
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

/**
 * 关掉应用后不能立刻再起一个：Electron 在数据目录里留的锁还没放干净，
 * 紧接着 launch 会卡在启动上（实测；并行跑整套 e2e、磁盘忙的时候尤其明显）。
 * 所以：先等一会儿，起不来就再等一轮重试，最多三轮。
 */
function settle(ms = 3000): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 关掉当前应用、再起一个带上限重试的实例（还原那条用例要「真的重启一次」）。 */
async function relaunchApp(dataDir: string): Promise<Page> {
  await app?.close()
  app = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await settle(attempt === 0 ? 5000 : 6000)
    const started = await Promise.race([
      launchApp(dataDir).then((instance) => instance),
      settle(25_000).then(() => null)
    ])
    if (started === null) continue
    app = started
    const window = await app.firstWindow()
    await window.waitForSelector('#btn-import')
    return window
  }
  throw new Error('应用在还原之后起不来（试了三轮）')
}

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

/**
 * 还原备份（0.4.0）：整库覆盖 + 换完库文件自动重启。
 *
 * 这里最要紧的一条是最后那步「重启后书能读」：备份包里只放原始文件与数据库快照，
 * 派生正文（content.txt / chapters/）不进包，靠启动自愈按 source.bin 重新提取补齐 ——
 * 那条链路断了的话，书架上看得到书、点进去却是空的。
 */
test('还原备份：整库覆盖，重启后书架与正文都回来了（派生正文由启动自愈补齐）', async () => {
  // 这条用例要开关应用两次 + 真的重启一次，比别的用例慢得多，超时放宽
  test.setTimeout(200_000)
  // 主进程换完库文件会自己重启应用；这条用例要自己关掉再重起一次（更硬），
  // 所以用官方留的口子（TWELVE_READ_NO_RELAUNCH）把自动重启关掉，由 helpers.childEnv 传给子进程。
  process.env['TWELVE_READ_NO_RELAUNCH'] = '1'
  const dataDir = makeTempDir('12read-restore-')
  const sourceDir = makeTempDir('12read-restore-src-')
  const zipPath = join(makeTempDir('12read-restore-out-'), '12read-backup.zip')

  // ① 先导出一份备份
  const page = await openShelf(dataDir, sourceDir)
  if (!app) throw new Error('应用还没启动')
  await stubSaveDialog(app, zipPath)
  await page.click('#btn-export')
  await expect(page.locator('#toast')).toHaveText(/已导出备份（1 本/, { timeout: 10_000 })
  await app.close()
  app = null
  await settle() // 等上一个进程把数据目录的锁放干净，紧接着再起会起不来

  // ② 把书库整个抹掉（模拟换了台机器 / 重装），此时书架是空的
  rmSync(join(dataDir, 'library.db'), { force: true })
  rmSync(join(dataDir, 'books'), { recursive: true, force: true })
  app = await launchApp(dataDir)
  const fresh = await app.firstWindow()
  await fresh.waitForSelector('#btn-import')
  await expect(fresh.locator('.book-card')).toHaveCount(0)

  await stubOpenDialog(app, [zipPath])
  await fresh.click('#btn-restore')
  await expect(fresh.locator('.modal h3')).toHaveText('从备份还原？')
  // danger 弹窗的确认按钮是 .btn.danger（见 Modal.tsx）
  await fresh.click('.modal-actions .btn.danger')

  await expect(fresh.locator('.modal h3')).toHaveText('还原完成', { timeout: 20_000 })
  await expect(fresh.locator('.modal')).toContainText('还原 1 本书的原始文件')

  // 还原前的书库整份挪进了 restore-undo-<时间>，不是直接删
  const undoDir = readdirSync(dataDir).find((name) => name.startsWith('restore-undo-'))
  expect(undoDir).toBeTruthy()

  // ④ 真的重启一次（比进程内 relaunch 更硬）：书架回来了，正文也补齐了。
  //    注意这一步顺带守着一个 0.4.0 的回归：这会儿**数据库连接已经关了**，
  //    关窗回调若还去写窗口状态就会抛「connection is not open」——
  //    那个异常会弹主进程错误框并把退出卡死，表现就是这里的 close 一直不返回。
  const restored = await relaunchApp(dataDir)
  await expect(restored.locator('.book-card')).toHaveCount(1)
  await expect(restored.locator('.book-title')).toHaveText('备份样书')

  await restored.click('.book-card')
  await expect(restored.locator('.chapter-title')).toHaveText('第一章 起点')
  await expect(restored.locator('#reader-content')).toContainText('第1章-第1段')

  delete process.env['TWELVE_READ_NO_RELAUNCH']
})

test('还原备份：用户取消时只提示，书库一点没动', async () => {
  const page = await openShelf(makeTempDir('12read-restore-cancel-'), makeTempDir('12read-restore-cancel-src-'))
  if (!app) throw new Error('应用还没启动')

  await stubOpenDialog(app, [])
  await page.click('#btn-restore')
  await expect(page.locator('.modal h3')).toHaveText('从备份还原？')
  await page.click('.modal-actions .btn.danger')
  await expect(page.locator('#toast')).toHaveText('已取消还原', { timeout: 10_000 })
  await expect(page.locator('.book-card')).toHaveCount(1)
})
