/**
 * 12read 领域类型。
 *
 * 偏移量语义（TECH.md 5.1，必须遵守）：
 *   CharOffset 是「解码后文本的 UTF-16 code unit 偏移」，不是字节偏移。
 *   中文全在 BMP，一个汉字算 1；emoji 等代理对算 2。
 *   所有涉及偏移的代码都必须遵守，并在单测里固定住。
 */

/** 解码后文本的 UTF-16 code unit 偏移。 */
export type CharOffset = number

export type BookId = string

/**
 * 支持的书籍格式。0.2.0 起不再只有 txt —— 提取器按格式分派，
 * 但下游（进度 / 书签 / 划线 / 搜索 / 统计）只认「连续正文 + 章节表 + UTF-16 偏移」，
 * 所以新增格式不会动到它们（TECH.md「格式路线图」）。
 */
export type BookFormat = 'txt' | 'epub' | 'mobi' | 'md' | 'pdf'

/**
 * 检测到的源文件编码。unknown 表示解码结果可疑，仅附警告，不阻塞导入。
 * big5 只可能来自用户手工指定（繁体老书常见），自动检测永远不会给出它。
 */
export type Encoding = 'utf-8' | 'utf-8-bom' | 'utf-16le' | 'utf-16be' | 'gb18030' | 'big5' | 'unknown'

/** 用户在「重新解码」里能选的编码；auto = 重新走一遍自动检测。 */
export const MANUAL_ENCODINGS = ['auto', 'utf-8', 'gb18030', 'big5', 'utf-16le', 'utf-16be'] as const
export type ManualEncoding = (typeof MANUAL_ENCODINGS)[number]

/** 手工指定时真正生效的编码（auto 不算）。 */
export type ForcedEncoding = Exclude<ManualEncoding, 'auto'>

/** single：整本解码文本按偏移 slice；sliced：导入时按章切文件。 */
export type ContentMode = 'single' | 'sliced'

/** chapter：正则识别到的章节；segment：定长兜底分段。UI 文案必须区分。 */
export type ChapterKind = 'chapter' | 'segment'

export interface Book {
  id: BookId
  title: string
  author: string | null
  format: BookFormat
  encoding: Encoding
  byteSize: number
  /** 解码后文本长度，UTF-16 code units。 */
  charCount: number
  chapterCount: number
  contentMode: ContentMode
  coverSeed: number
  addedAt: number
  lastOpenedAt: number | null
}

/**
 * 书架列表项：Book 再带上进度百分比。
 * 主进程用一次 LEFT JOIN 把进度带回来，渲染层不必为每本书各发一次 getProgress（N+1）。
 */
export interface ShelfBook extends Book {
  /** 0..100；从未读过是 0。 */
  percent: number
  /**
   * 书架封面地址（0.2.0）：EPUB 自带封面时给自定义协议地址，没有就是 null，
   * 界面退回「渐变底 + 书名首字」的占位封面。
   */
  coverUrl?: string | null
}

/**
 * 正文里的内联图片（0.2.0 第 5 项）：EPUB 每张图在正文里占一个 U+FFFC 占位符，
 * 这里给出「占位符偏移 → 可加载的 URL」，渲染层原地换成 <img>。
 */
export interface BookImage {
  /** 占位符在全书正文里的偏移（UTF-16）。 */
  offset: CharOffset
  /** 自定义协议地址（reader-image://…），由主进程按书库内的文件回应。 */
  url: string
}

export interface Chapter {
  bookId: BookId
  index: number
  title: string
  /**
   * 所属的「卷 / 册」名（0.2.0）：合集类 EPUB 才有，普通书与 TXT 为 null。
   * 只用于目录抽屉的分组展示，正文与阅读器标题不受影响。
   * （可选是为了不打扰既有测试夹具；库里这列始终有值或 NULL。）
   */
  groupTitle?: string | null
  /**
   * 直接父级的标题（0.2.0）：合集三级目录里的中间那一级。
   * 节这一行记的是它所属的「章」；册下面的章记的是册名（等于 groupTitle）。
   */
  parentTitle?: string | null
  /** 全文解码文本里的起始偏移。 */
  startOffset: CharOffset
  charLength: number
  kind: ChapterKind
}

export interface Progress {
  bookId: BookId
  chapterIndex: number
  /** 章内相对偏移，UTF-16 code units。 */
  charOffset: CharOffset
  /** 前 30 字引文，兜底锚点。 */
  anchorBefore: string | null
  /** 后 30 字引文，兜底锚点。 */
  anchorAfter: string | null
  /** 冗余展示值，不参与定位。 */
  percent: number
  updatedAt: number
  /** 为同步预留，本版写死本机 id。 */
  deviceId: string | null
}

/** 书签与划线的 id（uuid v4，由主进程生成）。 */
export type AnnotationId = string

/** 书签：章号 + 章内偏移，和进度用同一套定位语义。 */
export interface Bookmark {
  id: AnnotationId
  bookId: BookId
  chapterIndex: number
  /** 章内相对偏移，UTF-16 code units。 */
  charOffset: CharOffset
  /** 加书签时那一小段原文，列表里当摘要显示。 */
  excerpt: string
  createdAt: number
}

export interface Highlight {
  id: AnnotationId
  bookId: BookId
  chapterIndex: number
  startOffset: CharOffset
  endOffset: CharOffset
  /** 划线选中的原文，列表里显示、以后导出也用得上。 */
  text: string
  /** 备注：本版一律 null，字段先留着，以后加备注不用再迁库。 */
  note: string | null
  createdAt: number
}

/** 新建书签的入参（id / createdAt 由主进程补）。 */
export interface BookmarkInput {
  bookId: BookId
  chapterIndex: number
  charOffset: CharOffset
  excerpt: string
}

/** 新建划线的入参（id / createdAt / note 由主进程补）。 */
export interface HighlightInput {
  bookId: BookId
  chapterIndex: number
  startOffset: CharOffset
  endOffset: CharOffset
  text: string
}

/** 搜索范围：本章 or 全书（0.1.3 第 7 项）。 */
export type SearchScope = 'chapter' | 'book'

/** 范围选择器的顺序，也是 schema 里 z.enum 的取值。 */
export const SEARCH_SCOPES = ['chapter', 'book'] as const

/** 一条命中：位置用「章号 + 章内偏移」，上下文给列表行显示。 */
export interface SearchHit {
  chapterIndex: number
  chapterTitle: string
  /** 命中处在该章内的字符偏移（UTF-16 code units）。 */
  charOffset: CharOffset
  before: string
  match: string
  after: string
}

/** 每章命中次数，按章号升序；面板里给「12 处 · 3 章」用。 */
export interface ChapterHitCount {
  chapterIndex: number
  count: number
}

export interface SearchResult {
  /** 归一化之后的关键词（trim + 截断），面板回显用。 */
  query: string
  scope: SearchScope
  /** 命中总次数（每章最多数到 SEARCH_MAX_HITS_PER_CHAPTER 次）。 */
  total: number
  counts: ChapterHitCount[]
  hits: SearchHit[]
  /** true 表示还有没列出来的命中（超出每章或总体上限被截断）。 */
  truncated: boolean
}

/** 统计面板画多少天、列几本书（0.1.3 第 8 项）。 */
export const READING_STAT_DAYS = 14
export const READING_STAT_TOP_BOOKS = 5

/** 某一天的阅读量：day 是本地时区的 YYYY-MM-DD。 */
export interface ReadingDay {
  day: string
  ms: number
  chars: number
}

/** 单本书的累计阅读量，统计面板的排行榜用。 */
export interface ReadingBookStat {
  bookId: BookId
  title: string
  ms: number
  chars: number
}

/**
 * 「停下读过一会儿」的位置上报（0.1.4）。
 * 字数不在这里传：主进程按当天在这一章读到过的最远偏移去重后再算，
 * 免得来回刷、拖滚动条把同一段反复计入。
 */
export interface ReadSpanInput {
  bookId: BookId
  chapterIndex: number
  /** 停下来时的章内偏移。 */
  charOffset: number
  /** 进入这一章时的章内偏移：当天第一次读这一章时，水位线从这里起算。 */
  enteredAt: number
}

/**
 * 「有新版本」的信息（0.1.5）。只用于提示与打开下载页 —— 本版不做自动下载安装。
 * 检查失败时一律返回 null，界面什么都不用显示。
 */
export interface UpdateInfo {
  /** 远端版本号（已去掉 tag 的 v 前缀），如 '0.1.5'。 */
  version: string
  /** 该 Release 的网页地址，点「去下载」时交给系统浏览器打开。 */
  url: string
  /** 发布时间（ISO 字符串），远端没给就是 null。 */
  publishedAt: string | null
}

/**
 * 检查更新的结果（0.1.5）。分三态是为了手动检查时能给对提示：
 * 「已是最新」和「没连上网」对用户是完全不同的两件事，混在一起只能含糊其辞。
 */
export interface UpdateCheckResult {
  outcome: 'update' | 'latest' | 'failed'
  /** outcome === 'update' 时有值。 */
  info: UpdateInfo | null
}

/** 某个自然月的每日阅读量（0.1.4 的日历视图）：days 覆盖整月，没读的日子补 0。 */
export interface ReadingCalendar {
  /** 'YYYY-MM' */
  month: string
  /** 整月的每一天，从 1 号到最后一天。 */
  days: ReadingDay[]
  /** 当月单日最长时长，用来定色深；整月都没读时为 0。 */
  maxMs: number
}

export interface ReadingStats {
  todayMs: number
  todayChars: number
  totalMs: number
  totalChars: number
  /** 连续阅读天数：今天读过从今天数，今天还没读就从昨天往前数。 */
  streakDays: number
  /** 近 READING_STAT_DAYS 天，从早到晚，没记录的那天补 0。 */
  days: ReadingDay[]
  topBooks: ReadingBookStat[]
}

/** 导出备份的结果（0.1.3 第 9 项）：取消导出时 IPC 返回 null。 */
export interface BackupResult {
  /** 用户选定的 zip 落盘位置。 */
  path: string
  /** 整份 zip 的字节数。 */
  bytes: number
  /** 清单里记了几本书（含原始文件缺失的）。 */
  books: number
}

export type ImportStage =
  | 'reading'
  | 'detecting'
  | 'decoding'
  | 'splitting'
  | 'storing'
  | 'done'
  | 'error'

export interface ImportProgress {
  taskId: string
  filePath: string
  stage: ImportStage
  /** 0..1 */
  ratio: number
  message?: string
}

export type ImportErrorCode =
  | 'binary'
  | 'decode-failed'
  | 'cancelled'
  | 'io-error'
  | 'db-error'
  | 'unknown'

export interface ImportFailure {
  filePath: string
  code: ImportErrorCode
  message: string
}

export interface ImportWarning {
  filePath: string
  code: 'suspicious-decoding' | 'segmented-fallback' | 'truncated-metadata'
  message: string
}

export interface ImportOutcome {
  imported: Book[]
  failed: ImportFailure[]
  warnings: ImportWarning[]
}

/** 正文字体：只用系统自带字体，不额外打包字体文件（选项表见 renderer/src/core/typography.ts）。 */
export type FontFamilyKey = 'song' | 'hei' | 'kai' | 'fang' | 'deng'

/** 正文栏宽：一行放多少字（选项表见 renderer/src/core/typography.ts）。 */
export type PageWidthKey = 'narrow' | 'medium' | 'wide' | 'xlarge' | 'full'

export interface ReaderSettings {
  fontSize: number
  lineHeight: number
  theme: 'day' | 'night'
  /** 正文加粗：写给 --fw，.reader-content 读它。 */
  bold: boolean
  /** 正文字体，写给 --font-body。 */
  fontFamily: FontFamilyKey
  /** 正文栏宽，写给 --page-w。 */
  pageWidth: PageWidthKey
  /** 每日阅读目标（分钟）；0 表示没设目标（0.1.4）。 */
  dailyGoalMinutes: number
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  fontSize: 22,
  lineHeight: 1.9,
  theme: 'day',
  bold: false,
  fontFamily: 'song',
  pageWidth: 'medium',
  dailyGoalMinutes: 0
}

/** 单章渲染上限之上的分块阈值，见 TECH.md 8.1。 */
export const CHUNK_THRESHOLD_CHARS = 50_000
export const CHUNK_FIRST_RENDER_CHARS = 20_000

/** 32MB 以上走 sliced，见 TECH.md 5.3。 */
export const SLICE_MODE_BYTES = 32 * 1024 * 1024
