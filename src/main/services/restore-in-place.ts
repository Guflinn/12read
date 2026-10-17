/**
 * 还原编排（1.0.1）：换库之后**不退出应用**，原地重建运行时。
 *
 * 旧方案（0.4.0 / 1.0.0）是换完库就 `app.relaunch()` 重启——实测在用户真机上
 * 两种发行形态都不靠谱（免安装版的 execPath 在退出即被清理的临时目录里；
 * 独立 cmd 兜底也被进程作业对象连坐杀掉），用户看到的就是「还原完应用关了」。
 * 既然「退出再启动」不可靠，那就干脆不退：换库成功后把库重新打开、
 * 把所有仓储/服务重新装配一遍，窗口不动，渲染层自己刷新书架。
 *
 * 三种结局：
 *   ① 换库成功 + 重建成功 → 返回报告，应用原地继续（主流程）；
 *   ② 换库失败且连接没关过（校验类失败）→ 原样抛错，应用安然无恙；
 *   ③ 连接关了但重建失败（极罕见）→ 抛 `RestoreError(closed=true)`，
 *      由 ipc 弹窗并安排重启兜底 —— **重启的调度只发生在 ipc 一处**，
 *      这里不重复安排（否则会拉起两个实例）。
 */
import type { RestoreResult } from '@shared/types'
import { RestoreError } from './restore'

export interface RestoreInPlaceDeps {
  /** 停掉在跑的导入 / 解码（换库前先把要写库的活儿停干净）。 */
  cancelImports: () => void
  /** 换库：关连接 → 换文件 → 失败回滚（RestoreService.restoreFrom）。 */
  swap: (zipPath: string) => Promise<RestoreResult>
  /** 数据库连接还开着吗（区分「校验失败」与「动过文件」两类失败）。 */
  isDbOpen: () => boolean
  /** 原地重建运行时：重开库 + 重连所有仓储 / 服务 + 启动自愈。 */
  reopen: () => Promise<void>
}

export async function restoreInPlace(
  deps: RestoreInPlaceDeps,
  zipPath: string
): Promise<RestoreResult> {
  deps.cancelImports()

  let result: RestoreResult | null = null
  let swapError: unknown = null
  let swapClosedDb = false
  try {
    result = await deps.swap(zipPath)
  } catch (cause) {
    swapError = cause
    swapClosedDb = cause instanceof RestoreError && cause.closed
  }

  const needReopen = swapError === null || swapClosedDb
  if (needReopen) {
    try {
      await deps.reopen()
    } catch (cause) {
      console.error('[12read] 重新加载书库失败，只能重启应用兜底', cause)
      throw new RestoreError(
        (swapError === null
          ? '还原已完成，但重新加载书库失败'
          : '还原失败，书库已经退回原样，但重新加载也失败') + '，应用马上会重启一次。',
        true
      )
    }
  }

  if (swapError !== null) {
    // 连接关过的失败：运行时已经用「备份新库 / 回滚旧库」重建好了，应用没坏 ——
    // 把错误转成普通失败（closed=false），ipc 走 toast 就够，不用重启。
    throw swapClosedDb && swapError instanceof RestoreError
      ? new RestoreError(swapError.message, false)
      : swapError
  }
  return result as RestoreResult
}
