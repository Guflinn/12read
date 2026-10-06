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
  /** 目录里手动改分章：改名 / 合并 / 在指定字符位置拆开。 */
  chapterRename: 'chapter:rename',
  chapterMerge: 'chapter:merge',
  /** 书签与划线：章号 + 章内偏移，跟进度同一套定位语义。 */
  bookmarkList: 'bookmark:list',
  bookmarkAdd: 'bookmark:add',
  bookmarkRemove: 'bookmark:remove',
  highlightList: 'highlight:list',
  highlightAdd: 'highlight:add',
  highlightRemove: 'highlight:remove',
  /** 章节内 / 全书搜索（0.1.3 第 7 项）：直接扫正文，不建索引。 */
  bookSearch: 'book:search',
  /** 阅读统计（0.1.3 第 8 项）：renderer 按段上报时长与字数，书架汇总看一眼。 */
  statAdd: 'stat:add',
  /** 阅读统计（0.1.4）：renderer 报「在这儿停下读过」的位置，字数由主进程按当天水位线去重后算。 */
  statRead: 'stat:read',
  statGet: 'stat:get',
  /** 导出备份（0.1.3 第 9 项）：整库打一个 zip，只导出不恢复。 */
  backupExport: 'backup:export',
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
