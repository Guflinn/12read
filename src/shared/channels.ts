/** IPC 通道清单（TECH.md 4.1）。通道名即字符串常量，preload 白名单穷举。 */
export const CH = {
  filePick: 'file:pick',
  bookImport: 'book:import',
  bookList: 'book:list',
  bookGet: 'book:get',
  bookRename: 'book:rename',
  bookDelete: 'book:delete',
  /** 用指定编码重新解码已导入的书（原始字节一直留着，不用重新导入）。 */
  bookRedecode: 'book:redecode',
  bookChapters: 'book:chapters',
  chapterRead: 'chapter:read',
  progressGet: 'progress:get',
  progressSave: 'progress:save',
  /** 退出前的同步落盘：beforeunload 里异步 IPC 未必来得及（TECH.md 6.3）。 */
  progressFlush: 'progress:flush',
  taskCancel: 'task:cancel',
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  appInfo: 'app:info',
  importProgress: 'import:progress'
} as const

export type ChannelName = (typeof CH)[keyof typeof CH]
