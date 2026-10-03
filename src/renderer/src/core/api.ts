import type { ReaderApi } from '@shared/api'

let current: ReaderApi | null = null

/**
 * 渲染进程访问 main 的唯一入口。
 * main.tsx 启动时注入 window.reader；单测注入假实现，因此 store 不直接碰 window。
 */
export function setReaderApi(api: ReaderApi): void {
  current = api
}

export function readerApi(): ReaderApi {
  if (!current) throw new Error('reader API 尚未注入')
  return current
}
