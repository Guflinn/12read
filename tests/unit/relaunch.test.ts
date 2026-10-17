import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  planRestart,
  RELAUNCH_DELAY_MS,
  RESTART_WAIT_PINGS,
  scheduleRestartAfterDelay
} from '@main/services/relaunch'

/** 免安装版（portable）启动器放进环境变量的原始便携 exe 路径。 */
const PORTABLE_EXE = 'D:\\下载\\twelve-read-portable-1.0.0.exe'
/** 安装版的安装位置（可能带空格）。 */
const INSTALLED_EXE = 'C:\\Users\\Lin\\AppData\\Local\\Programs\\12read\\十二阅读.exe'

describe('还原后的重启计划（planRestart）', () => {
  it('开发态走 Electron 原生 relaunch（没有便携壳问题）', () => {
    expect(
      planRestart({ isPackaged: false, execPath: INSTALLED_EXE, portableExecutableFile: undefined })
    ).toEqual({ mode: 'electron-relaunch' })
  })

  it('安装版：派生独立 cmd，等约 2 秒后拉起安装目录里的 exe', () => {
    const plan = planRestart({
      isPackaged: true,
      execPath: INSTALLED_EXE,
      portableExecutableFile: undefined
    })
    expect(plan.mode).toBe('spawn-detached')
    if (plan.mode !== 'spawn-detached') return
    expect(plan.command).toBe('cmd.exe')
    expect(plan.args).toEqual([
      '/d',
      '/s',
      '/c',
      'ping -n ' + RESTART_WAIT_PINGS + ' -w 1000 127.0.0.1 >nul & start "" "' + INSTALLED_EXE + '"'
    ])
  })

  it('免安装版：目标是外层便携 exe 本体（process.execPath 在临时解包目录里，退出即被清理）', () => {
    const plan = planRestart({
      isPackaged: true,
      execPath: 'C:\\Temp\\12read\\十二阅读.exe',
      portableExecutableFile: PORTABLE_EXE
    })
    if (plan.mode !== 'spawn-detached') throw new Error('打包版必须是 spawn-detached')
    expect(plan.args[3]).toContain('start "" "' + PORTABLE_EXE + '"')
    expect(plan.args[3]).not.toContain('C:\\Temp')
  })

  it('PORTABLE_EXECUTABLE_FILE 是空字符串时按没设处理，退回 execPath', () => {
    const plan = planRestart({ isPackaged: true, execPath: INSTALLED_EXE, portableExecutableFile: '' })
    if (plan.mode !== 'spawn-detached') throw new Error('打包版必须是 spawn-detached')
    expect(plan.args[3]).toContain('start "" "' + INSTALLED_EXE + '"')
  })

  it('带空格的路径整体包在引号里（start 的标题占位在前）', () => {
    const withSpace = 'D:\\My Files\\十二阅读.exe'
    const plan = planRestart({ isPackaged: true, execPath: withSpace, portableExecutableFile: undefined })
    if (plan.mode !== 'spawn-detached') throw new Error('打包版必须是 spawn-detached')
    expect(plan.args[3]).toBe(
      'ping -n ' + RESTART_WAIT_PINGS + ' -w 1000 127.0.0.1 >nul & start "" "' + withSpace + '"'
    )
  })
})

describe('还原后的重启调度（scheduleRestartAfterDelay）', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  type Deps = Parameters<typeof scheduleRestartAfterDelay>[0]

  function makeDeps(overrides?: Partial<Deps>): {
    deps: Deps
    timers: Array<{ fn: () => void; ms: number }>
    exit: ReturnType<typeof vi.fn>
    relaunch: ReturnType<typeof vi.fn>
    spawnDetached: ReturnType<typeof vi.fn>
  } {
    const timers: Array<{ fn: () => void; ms: number }> = []
    const exit = vi.fn()
    const relaunch = vi.fn()
    const spawnDetached = vi.fn()
    const deps: Deps = {
      isPackaged: true,
      execPath: INSTALLED_EXE,
      portableExecutableFile: undefined,
      noRelaunchEnv: undefined,
      relaunch,
      spawnDetached,
      exit,
      setTimer(fn, ms) {
        timers.push({ fn, ms })
        return timers.length
      }
    }
    return { deps: { ...deps, ...overrides }, timers, exit, relaunch, spawnDetached }
  }

  it('延时 RELAUNCH_DELAY_MS 后执行并退出（exit code 0）', () => {
    const { deps, timers, exit } = makeDeps()
    scheduleRestartAfterDelay(deps)
    expect(timers).toHaveLength(1)
    expect(timers[0]!.ms).toBe(RELAUNCH_DELAY_MS)
    timers[0]!.fn()
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('打包版：延时到点后派生独立 cmd 拉起 exe（不依赖 app.relaunch）', () => {
    const { deps, timers, spawnDetached, relaunch } = makeDeps({
      portableExecutableFile: PORTABLE_EXE
    })
    scheduleRestartAfterDelay(deps)
    timers[0]!.fn()
    expect(spawnDetached).toHaveBeenCalledWith(
      'cmd.exe',
      ['/d', '/s', '/c', 'ping -n ' + RESTART_WAIT_PINGS + ' -w 1000 127.0.0.1 >nul & start "" "' + PORTABLE_EXE + '"']
    )
    expect(relaunch).not.toHaveBeenCalled()
    expect(deps.exit).toHaveBeenCalledWith(0)
  })

  it('开发版：仍走 Electron 原生 relaunch，不派生 cmd', () => {
    const { deps, timers, spawnDetached, relaunch } = makeDeps({ isPackaged: false })
    scheduleRestartAfterDelay(deps)
    timers[0]!.fn()
    expect(relaunch).toHaveBeenCalledTimes(1)
    expect(spawnDetached).not.toHaveBeenCalled()
  })

  it('TWELVE_READ_NO_RELAUNCH=1 时不安排任何重启（e2e 的口子）', () => {
    const { deps, timers, exit } = makeDeps({ noRelaunchEnv: '1' })
    scheduleRestartAfterDelay(deps)
    expect(timers).toHaveLength(0)
    expect(exit).not.toHaveBeenCalled()
  })

  it('其他取值的 TWELVE_READ_NO_RELAUNCH 不影响重启', () => {
    const { deps, timers } = makeDeps({ noRelaunchEnv: '0' })
    scheduleRestartAfterDelay(deps)
    expect(timers).toHaveLength(1)
  })
})
