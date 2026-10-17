import { spawn } from 'node:child_process'

/**
 * 换完库文件后的重启（0.4.0 引入，1.0.0 后重做）：
 * 主进程里所有仓储都还攥着旧的数据库连接，与其在进程内重新装配一遍
 * （容易漏掉某个缓存），不如重启来得干净可预期。
 */

/** 留给界面把「还原完成，正在重启」显示出来的延时（毫秒）。 */
export const RELAUNCH_DELAY_MS = 1200

/**
 * 独立命令等老进程退干净的 ping 次数：`ping -n 3` 实际等约 2 秒。
 * 不用 `timeout` —— 它碰到被重定向/关闭的 stdin 会直接报错退出。
 */
export const RESTART_WAIT_PINGS = 3

export interface RestartPlanInput {
  isPackaged: boolean
  /** 当前进程的可执行文件（安装版 = 安装目录里的 exe）。 */
  execPath: string
  /** 免安装版（electron-builder portable）启动器放进环境变量的原始便携 exe 路径。 */
  portableExecutableFile: string | undefined
}

export type RestartPlan =
  | { mode: 'electron-relaunch' }
  | { mode: 'spawn-detached'; command: string; args: string[] }

/**
 * 算出「怎么重启」：
 *
 * - 开发态：Electron 原生 `app.relaunch()` 就够了，没有便携壳的问题。
 * - 打包版（安装版 + 免安装版）：`app.relaunch()` 是退出后按 `process.execPath`
 *   拉起新进程 —— 免安装版的 execPath 指向**临时解包目录里的真身**，老进程一退
 *   启动器就把目录清了，拉起必然失败（用户看到的就是「还原完应用自己关了，
 *   像闪退」）；安装版也可能被杀软 / 文件锁绊住，而且 relaunch 失败是静默的，
 *   没法兜底检测。所以统一改成：先派生一个**独立**的 cmd（不随主进程退出而死），
 *   等约 2 秒老进程退干净，再 `start` 真正的 exe —— 免安装版用外层便携 exe 本体
 *   （启动器放进 `PORTABLE_EXECUTABLE_FILE`），安装版用安装目录里的 exe。
 */
export function planRestart(input: RestartPlanInput): RestartPlan {
  if (!input.isPackaged) return { mode: 'electron-relaunch' }
  const target =
    input.portableExecutableFile !== undefined && input.portableExecutableFile !== ''
      ? input.portableExecutableFile
      : input.execPath
  return {
    mode: 'spawn-detached',
    command: 'cmd.exe',
    args: [
      '/d',
      '/s',
      '/c',
      // `start "" ` 的第一个引号参数是窗口标题占位，路径必须再包一层引号（可能带空格）
      'ping -n ' + RESTART_WAIT_PINGS + ' -w 1000 127.0.0.1 >nul & start "" "' + target + '"'
    ]
  }
}

/** 把计划真正执行掉：只有 spawn-detached 需要动手，electron-relaunch 由调用方接着 exit。 */
export function executeRestart(
  plan: RestartPlan,
  run: {
    relaunch: () => void
    spawnDetached: (command: string, args: string[]) => void
  }
): void {
  if (plan.mode === 'electron-relaunch') {
    run.relaunch()
    return
  }
  run.spawnDetached(plan.command, plan.args)
}

/** ipc.ts 的真实执行端：独立进程、隐藏窗口、不随主进程退出（unref 后才能安心 exit）。 */
export function spawnDetached(command: string, args: string[]): void {
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  })
  child.unref()
}

/** 还原之后调度一次重启；`TWELVE_READ_NO_RELAUNCH=1` 时不重启（e2e 的口子）。 */
export function scheduleRestartAfterDelay(input: {
  isPackaged: boolean
  execPath: string
  portableExecutableFile: string | undefined
  noRelaunchEnv: string | undefined
  relaunch: () => void
  spawnDetached: (command: string, args: string[]) => void
  exit: (code: number) => void
  setTimer: (fn: () => void, ms: number) => unknown
}): void {
  if (input.noRelaunchEnv === '1') {
    console.info('[12read] 已按 TWELVE_READ_NO_RELAUNCH=1 跳过重启（测试用）')
    return
  }
  input.setTimer(() => {
    executeRestart(
      planRestart({
        isPackaged: input.isPackaged,
        execPath: input.execPath,
        portableExecutableFile: input.portableExecutableFile
      }),
      { relaunch: input.relaunch, spawnDetached: input.spawnDetached }
    )
    input.exit(0)
  }, RELAUNCH_DELAY_MS)
}
