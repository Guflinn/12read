import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

/** e2e 前先打一次包（渲染层/主进程都用 out/ 里的产物） */
export default function globalSetup(): void {
  const root = process.cwd()
  const bin = join(root, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')
  const result = spawnSync(process.execPath, [bin, 'build'], { cwd: root, stdio: 'inherit' })
  if (result.status !== 0) {
    throw new Error('electron-vite build 失败，e2e 无法运行')
  }
}
