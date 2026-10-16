/**
 * 书架左下角那颗更新胶囊的文案（0.4.0）。
 *
 * 抽成纯函数是因为它的状态组合有点多（有没有新版 / 在下载 / 下好了），
 * 而这些组合全都要在界面上说人话，靠单测钉住比靠眼力强。
 */
import type { UpdateInfo, UpdateProgress } from '@shared/types'

export function updateNoticeText(info: UpdateInfo, progress: UpdateProgress | null): string {
  if (progress !== null) {
    if (progress.state === 'ready') {
      return '已下载 v' + (progress.version ?? info.version) + ' · 重启并更新'
    }
    if (progress.state === 'downloading') {
      // 拿不到百分比时不要显示 0%：那看起来像卡住了
      return progress.percent === null
        ? '正在下载更新…'
        : '正在下载更新 ' + progress.percent + '%'
    }
    if (progress.state === 'started') return '正在准备下载…'
    if (progress.state === 'unsupported') return '有新版本 v' + info.version + ' · 去下载'
  }
  return '有新版本 v' + info.version + ' · 更新'
}

/** 胶囊能不能点：下载中禁掉，免得点出第二次下载。 */
export function updateNoticeEnabled(progress: UpdateProgress | null): boolean {
  return progress === null || (progress.state !== 'downloading' && progress.state !== 'started')
}
