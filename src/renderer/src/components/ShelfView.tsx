import { useEffect, useState } from 'react'
import { todayReadText } from '@shared/core/stats'
import type { Book, ManualEncoding, ShelfBook, UpdateInfo } from '@shared/types'
import { readerApi } from '@/core/api'
import {
  coverGradient,
  coverInitial,
  describeBook,
  formatBytes,
  formatChars,
  formatPercent,
  formatRelative
} from '@/core/reading'
import { ENCODING_CHOICES } from '@/core/encoding-choices'
import { SHELF_SORTS, shelfView, type ShelfSort } from '@/core/shelf'
import { useLibraryStore } from '@/store/library'
import { useSettingsStore } from '@/store/settings'
import { ImportStatus } from './ImportStatus'
import { Modal } from './Modal'
import { StatsSheet } from './StatsSheet'
import { toast } from './Toast'

/** 每次启动只自动查一次（ShelfView 会随路由反复挂载，别每回书架都打一次网络）。 */
let autoCheckedOnce = false

function BookCard({
  book,
  percent,
  now,
  onOpen,
  onRename,
  onRedecode,
  onDelete
}: {
  book: ShelfBook
  percent: number
  now: number
  onOpen(): void
  onRename(): void
  /** 编码认错时换一个编码重解，不用重新导入 */
  onRedecode(): void
  onDelete(): void
}): React.JSX.Element {
  return (
    <div
      className="book-card"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
    >
      <div className="cover" style={{ background: coverGradient(book.coverSeed) }}>
        <span className="cover-char">{coverInitial(book.title)}</span>
        <span className="cover-badge">{book.encoding.toUpperCase()}</span>
      </div>
      <div className="card-actions">
        <button
          className="card-encoding"
          onClick={(event) => {
            event.stopPropagation()
            onRedecode()
          }}
        >
          编码
        </button>
        <button
          className="card-rename"
          onClick={(event) => {
            event.stopPropagation()
            onRename()
          }}
        >
          重命名
        </button>
        <button
          className="card-delete"
          onClick={(event) => {
            event.stopPropagation()
            onDelete()
          }}
        >
          删除
        </button>
      </div>
      <div className="book-title" title={book.title}>
        {book.title}
      </div>
      <div className="book-author" title={book.author ?? describeBook(book)}>
        {book.author ?? describeBook(book)}
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: percent.toFixed(2) + '%' }} />
      </div>
      <div className="book-foot">
        <span>已读 {formatPercent(percent)}</span>
        <span>{formatRelative(book.lastOpenedAt === null ? book.addedAt : book.lastOpenedAt, now)}</span>
      </div>
    </div>
  )
}

export function ShelfView({
  onOpen,
  version
}: {
  onOpen(bookId: string): void
  /** 应用版本号，钉在书架左下角；拿不到就什么都不显示 */
  version: string
}): React.JSX.Element {
  const books = useLibraryStore((s) => s.books)
  const loading = useLibraryStore((s) => s.loading)
  const importPaths = useLibraryStore((s) => s.importPaths)
  const pickAndImport = useLibraryStore((s) => s.pickAndImport)
  const rename = useLibraryStore((s) => s.rename)
  const redecode = useLibraryStore((s) => s.redecode)
  const remove = useLibraryStore((s) => s.remove)
  const [hot, setHot] = useState(false)
  const [renaming, setRenaming] = useState<Book | null>(null)
  const [renameText, setRenameText] = useState('')
  const [deleting, setDeleting] = useState<Book | null>(null)
  const [recoding, setRecoding] = useState<Book | null>(null)
  const [recodingTo, setRecodingTo] = useState<ManualEncoding>('auto')
  const [scopeOpen, setScopeOpen] = useState(false)
  const [statsOpen, setStatsOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<ShelfSort>('recent')
  /** 今天读了多久（0.1.4）：进书架时取一次；从阅读器回来自会重新挂载，所以不用订阅。 */
  const [todayMs, setTodayMs] = useState<number | null>(null)
  /** 检查更新（0.1.5）：只提示不下载；失败静默。 */
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const dailyGoalMinutes = useSettingsStore((s) => s.settings.dailyGoalMinutes)
  const now = Date.now()
  const totalChars = books.reduce((sum, book) => sum + book.charCount, 0)
  const shown = shelfView(books, query, sort)
  const filtering = query.trim().length > 0
  // 没读又没设目标时是空串，那行就不显示（见 shared/core/stats.ts）
  const todayText = todayMs === null ? '' : todayReadText(todayMs, dailyGoalMinutes)

  /** 手动检查：三种结果都给一句准话，别让人不知道点没点上。 */
  const checkUpdate = (): void => {
    if (checkingUpdate) return
    setCheckingUpdate(true)
    readerApi()
      .checkUpdate()
      .then((result) => {
        if (result.outcome === 'update' && result.info) {
          setUpdateInfo(result.info)
          toast('发现新版本 v' + result.info.version + '，点左下角那行去下载')
        } else if (result.outcome === 'latest') {
          toast('已是最新版本 v' + version)
        } else {
          toast('检查更新失败：多半是没连上网')
        }
      })
      .catch(() => toast('检查更新失败'))
      .finally(() => setCheckingUpdate(false))
  }

  const openUpdatePage = (): void => {
    if (!updateInfo) return
    void readerApi()
      .openUpdatePage(updateInfo.url)
      .catch(() => toast('打不开下载页'))
  }

  // 启动后静默查一次更新（每次会话一次）。查不到 / 没网都不吭声 —— 那不是用户要处理的事。
  useEffect(() => {
    if (autoCheckedOnce) return
    autoCheckedOnce = true
    let alive = true
    readerApi()
      .checkUpdate()
      .then((result) => {
        if (alive && result.outcome === 'update' && result.info) setUpdateInfo(result.info)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    readerApi()
      .getReadingStats(1)
      .then((result) => {
        if (alive) setTodayMs(result.todayMs)
      })
      .catch(() => {
        // 统计读不出来不影响书架：那行不显示就是
        if (alive) setTodayMs(null)
      })
    return () => {
      alive = false
    }
  }, [])

  /**
   * 导出备份：主进程弹「另存为」，然后把整库打包写出去。
   * 期间按钮禁用，避免连点导出两份；用户取消返回 null，不当失败。
   */
  const exportBackup = (): void => {
    if (exporting) return
    setExporting(true)
    void readerApi()
      .exportBackup()
      .then((result) => {
        if (result === null) toast('已取消导出')
        else toast('已导出备份（' + result.books + ' 本 · ' + formatBytes(result.bytes) + '）')
      })
      .catch((cause: unknown) => {
        toast('导出失败：' + (cause instanceof Error ? cause.message : String(cause)))
      })
      .finally(() => setExporting(false))
  }

  const importFiles = (files: FileList | null): void => {
    const list = files ? Array.from(files) : []
    const paths: string[] = []
    for (const file of list) {
      try {
        const path = readerApi().pathForFile(file)
        if (path) paths.push(path)
      } catch {
        // 非文件拖放（比如拖来一段文本）忽略即可
      }
    }
    if (paths.length === 0) {
      toast('没能拿到文件路径，请用「导入 TXT」按钮选择')
      return
    }
    void importPaths(paths)
  }

  return (
    <section id="view-shelf" className="view active">
      <div className="shelf-wrap">
        <header className="shelf-header">
          <div className="brand">
            <div className="logo">十二</div>
            <div>
              <h1>十二阅读</h1>
              <p>本地 TXT 阅读器 · 数据只存在这台电脑上</p>
            </div>
          </div>
          <div className="shelf-actions">
            <button id="btn-import" className="btn primary" onClick={() => void pickAndImport()}>
              ＋ 导入 TXT
            </button>
            <button id="btn-stats" className="btn ghost" onClick={() => setStatsOpen(true)}>
              阅读统计
            </button>
            <button
              id="btn-export"
              className="btn ghost"
              disabled={exporting}
              onClick={exportBackup}
            >
              {exporting ? '导出中…' : '导出备份'}
            </button>
            <button id="btn-scope" className="btn ghost" onClick={() => setScopeOpen(true)}>
              范围说明
            </button>
          </div>
        </header>

        <div
          id="dropzone"
          className={hot ? 'dropzone hot' : 'dropzone'}
          role="button"
          tabIndex={0}
          onClick={() => void pickAndImport()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void pickAndImport()
          }}
          onDragOver={(event) => {
            event.preventDefault()
            setHot(true)
          }}
          onDragLeave={() => setHot(false)}
          onDrop={(event) => {
            event.preventDefault()
            setHot(false)
            importFiles(event.dataTransfer.files)
          }}
        >
          把 .txt 拖到这里，或点击此处导入（支持多选）
        </div>

        <ImportStatus />

        {books.length > 0 ? (
          <div className="shelf-tools">
            <input
              id="shelf-search"
              className="shelf-search"
              type="search"
              value={query}
              placeholder="搜索书名或作者"
              onChange={(event) => setQuery(event.target.value)}
            />
            <label className="shelf-sort">
              排序
              <select
                id="shelf-sort"
                value={sort}
                onChange={(event) => setSort(event.target.value as ShelfSort)}
              >
                {SHELF_SORTS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            {filtering ? <span id="shelf-match">匹配 {shown.length} 本</span> : null}
          </div>
        ) : null}

        <div className="shelf-bar">
          <span id="shelf-count">
            {books.length === 0 ? '书架空着' : books.length + ' 本 · 共 ' + formatChars(totalChars)}
          </span>
          {todayText ? (
            <span id="shelf-today" title="今天的阅读时长">
              {todayText}
            </span>
          ) : null}
          <span id="storage-note">本地 SQLite 存储 · 不联网</span>
        </div>

        {loading && books.length === 0 ? <div className="empty">正在读取书架…</div> : null}
        {!loading && books.length === 0 ? (
          <div className="empty" id="shelf-empty">
            书架还是空的，导入一本开始吧
          </div>
        ) : null}
        {!loading && books.length > 0 && filtering && shown.length === 0 ? (
          <div className="empty" id="shelf-nomatch">
            没有匹配的书
          </div>
        ) : null}
        <div className="shelf-grid" id="shelf-grid">
          {shown.map((book) => (
            <BookCard
              key={book.id}
              book={book}
              // 进度来自 book:list 的 LEFT JOIN，不再逐本查一次
              percent={book.percent}
              now={now}
              onOpen={() => onOpen(book.id)}
              onRename={() => {
                setRenaming(book)
                setRenameText(book.title)
              }}
              onRedecode={() => {
                setRecoding(book)
                setRecodingTo('auto')
              }}
              onDelete={() => setDeleting(book)}
            />
          ))}
        </div>
      </div>

      <footer className="app-footer">
        {version ? (
          <span className="app-version" id="app-version" title={'十二阅读 ' + version}>
            v{version}
          </span>
        ) : null}
        <button
          className="app-check-update"
          id="btn-check-update"
          disabled={checkingUpdate}
          onClick={checkUpdate}
        >
          {checkingUpdate ? '正在检查…' : '检查更新'}
        </button>
        {updateInfo ? (
          <button className="app-update-notice" id="update-notice" onClick={openUpdatePage}>
            有新版本 v{updateInfo.version} · 去下载
          </button>
        ) : null}
      </footer>

      {renaming ? (
        <Modal
          title="重命名"
          confirmLabel="保存"
          onCancel={() => setRenaming(null)}
          onConfirm={() => {
            const target = renaming
            setRenaming(null)
            void rename(target.id, renameText).then(() => toast('已重命名'))
          }}
        >
          <input
            autoFocus
            value={renameText}
            onChange={(event) => setRenameText(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
          />
        </Modal>
      ) : null}

      {deleting ? (
        <Modal
          title="删除这本书？"
          confirmLabel="删除"
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const target = deleting
            setDeleting(null)
            void remove(target.id).then(() => toast('已删除'))
          }}
        >
          <p className="modal-text">
            《{deleting.title}》的正文、章节与阅读进度都会从本机删除，无法撤销。
          </p>
        </Modal>
      ) : null}

      {recoding ? (
        <Modal
          title="重新解码"
          confirmLabel="开始重新解码"
          onCancel={() => setRecoding(null)}
          onConfirm={() => {
            const target = recoding
            setRecoding(null)
            void redecode(target.id, recodingTo).then(() => toast('已按新编码重新解码'))
          }}
        >
          <p className="modal-text">
            《{recoding.title}》现在按 <b>{recoding.encoding.toUpperCase()}</b> 解码。正文如果是乱码，
            换一个编码再解一遍——原始文件一直留着，不用重新导入。
          </p>
          <div className="encoding-choices" id="redecode-choices">
            {ENCODING_CHOICES.map((choice) => (
              <button
                key={choice.value}
                id={'redecode-' + choice.value}
                className={recodingTo === choice.value ? 'pill on' : 'pill'}
                data-encoding-choice={choice.value}
                title={choice.hint}
                onClick={() => setRecodingTo(choice.value)}
              >
                {choice.label}
              </button>
            ))}
          </div>
          <p className="modal-note">重新解码会把这本书的阅读进度清零（字符位置全变了）。</p>
        </Modal>
      ) : null}

      <StatsSheet open={statsOpen} onClose={() => setStatsOpen(false)} />

      {scopeOpen ? (
        <Modal title="这个版本做什么" confirmLabel="知道了" cancelLabel="关闭" onCancel={() => setScopeOpen(false)} onConfirm={() => setScopeOpen(false)}>
          <p className="scope-h">现在能用</p>
          <ul className="scope-list">
            <li>导入本地 .txt：拖入或选择文件，自动识别 UTF-8 / GBK / UTF-16 编码</li>
            <li>自动分章：识别「第 N 章」这类标题，识别不到就按字数分段</li>
            <li>
              阅读：← / → 翻一屏（Ctrl + ← → 切章）、目录跳转、字号 / 行距 / 字重 / 字体 / 宽度 / 日夜间
            </li>
            <li>书架：搜索书名或作者，按最近阅读 / 导入时间 / 书名 / 进度排序</li>
            <li>进度：关掉再打开，回到上次读到的那个字；顶栏「上次位置」来回对照</li>
            <li>乱码书重新解码：在书封面上点「编码」，挑 UTF-8 / GBK / BIG5 / UTF-16 重解一遍，不用重新导入</li>
            <li>手动改分章：目录里给每一节改名，或把它并进上一节</li>
            <li>书签与划线：顶栏 🔖 记位置，选中一段字划线；目录抽屉里分「书签 / 划线」两页</li>
            <li>搜索：Ctrl + F 在章节内或全书找词，结果上是章名与上下文</li>
            <li>阅读统计：书架右上角「阅读统计」，看今天 / 累计时长与字数、连续天数、最近两周、读得最多的书</li>
            <li>导出备份：整库打成一个 zip（数据库快照 + 每本书的原始文件 + 清单），存到你选的位置</li>
          </ul>
          <p className="scope-h">还不在范围内</p>
          <ul className="scope-list">
            <li>备份还原（现在只能导出，还不能从备份还原回来）</li>
            <li>笔记（划线只能记原文，还不能在旁边写字）</li>
            <li>EPUB / PDF / MOBI（数据结构已为 EPUB 预留）</li>
            <li>账号、云同步、在线书城、TTS 朗读</li>
          </ul>
        </Modal>
      ) : null}
    </section>
  )
}

