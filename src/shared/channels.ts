/** IPC 通道清单（TECH.md 4.1）。通道名即字符串常量，preload 白名单穷举。 */
export const CH = {
  filePick: 'file:pick',
  bookImport: 'book:import',
  bookList: 'book:list',
  bookGet: 'book:get',
  bookRename: 'book:rename',
  bookDelete: 'book:delete',
  bookChapters: 'book:chapters',
  chapterRead: 'chapter:read',
  progressGet: 'progress:get',
  progressSave: 'progress:save',
  taskCancel: 'task:cancel',
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  appInfo: 'app:info',
  importProgress: 'import:progress'
} as const

export type ChannelName = (typeof CH)[keyof typeof CH]
