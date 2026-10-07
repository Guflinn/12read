# 12read 技术方案（Electron 桌面版）

> 状态：待评审
> 更新时间：2026 年
> 上游文档：[MVP.md](MVP.md) 定义「做什么 / 不做什么」；本文档定义「怎么搭」。
> 范围约束：本文档不扩大 MVP。仍是只做 TXT，仍是 MVP 第 3 节那五块 P0。

## 0. 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-10-08 | 0.2.0：合集类 EPUB 的「册」分组（**schema v4**，纯加列 `chapter.group_title`）。起因：用户指出《莫言作品全集（共18册）》是一个文件装 18 本书，而我当时只按「章」切，**册名被同落点去重吃掉**（实测 18 个册名只剩 8 个、每册还漏 1 章），读者看到的是一串平铺的章，判断不出属于哪本书。排查出两个真问题：① **同落点去重把册名吞了**；② **每册漏的那 1 章叫「封面」**——那是纯图片页，标题只写在 `<head><title>` 里（提取时会跳过 `<head>`），所以标题匹配必然失败、整条被丢。改法：`chapters.ts` 里按文档顺序跟踪当前「册」（**只有下面真挂着子项的顶层条目才算册**，否则一本目录本来就平的书会被当成「每章自成一册」）；册名写进 `groupTitle`；标题找不到但**这一页没有文字（只有空白与图片占位符）**时，落点定在文件开头而不是丢掉（有正文但对不上标题的仍然跳过，不硬塞）。渲染层新增纯函数 `core/toc-groups.ts`（按 groupTitle 切连续组、标出每组首项），`TocDrawer` 每册画一条分隔（册名与首项同名时不重复画组名，改把那一条染成「册首」样式，仍可点可跳）。真书验收：莫言那本 **328 章 → 353 章**（10 个封面页捞回）、**21 组**（18 册 + 开篇）、每册章数正确、章节表仍无缝覆盖；古龙那本（扁平目录）**90 章零分组**，行为完全不变。 |
| 2026-10-07 | 0.2.0 EPUB 接线与内联图片（第 4–8 项，**功能已完整**）。`BookFormat` 扩成 `'txt' \| 'epub' \| 'mobi' \| 'md' \| 'pdf'`；`DecodeJob` 加 `format`，结果加 `format` / `title` / `author`；`decode-job.ts` 把「解码」与「落盘」拆开：**先按格式解出 payload（失败就什么都不落盘），再统一写 source.bin / content.txt 或 chapters/NNNN.txt**（TXT 与 EPUB 共用；这条是被既有单测「二进制文件不建目录」逼出来的正确形状）。`importer.ts` 按扩展名分派（`.epub` → 'epub'），书名作者优先用 OFP 里的、缺了才退文件名清洗；`redecode` 对 EPUB 等价于「用最新提取器重新提取」（忽略编码参数），UI 相应把弹窗改成「重新提取」且不给编码选项。`book:images` 只给清单，**图片字节走自定义协议** `reader-image://<bookId>/<file>`：`BookImagesService` 读写 `images/` + `images.json`（按源文件去重、顺序编号），协议侧只允许书库内该书的 images 目录（`assertInside`）、文件名白名单、非法一律 404；`protocol.registerSchemesAsPrivileged` 必须在 app ready 前登记，CSP 的 `img-src` 放行 `reader-image:`。渲染层 `core/images.ts`（纯函数：`chapterImages` 换坐标、`splitByImages` 按 U+FFFC 切片）→ 段落里原地渲染 `<img>`，搜索上下文显示「[图]」。**性能实测**（真书、切片模式全套）：642KB/90 章 123ms；8.29MB/458 万字/328 章 + 31 图 466ms（预算 <2s）。e2e 新增 `epub.spec.ts`：自有夹具（`tests/fixtures/mini.epub`，EPUB 3 + nav + 图）走完导入 → 书名作者 → 切章 → **图片经协议真的加载出来**（`naturalWidth > 0`，同时验证协议与 CSP）→ 重启保进度 → 搜索命中。**打完包冒烟时又逮到一个**：`mappers.toBook` 从 0.1.x 起把 `format` **写死成 `'txt'`**（那时只有一种格式），导致 EPUB 书读回来永远自称 TXT —— 书架角标、「提取」按钮、「重新提取」弹窗全部不生效；已改成读列 + 白名单校验（认不出的退 txt），并补了单测与 e2e 断言（角标 `EPUB` / 按钮「提取」）。 |
| 2026-10-07 | 0.2.0 EPUB 解码链路的纯函数层（第 1–3 项，尚未接线到导入管线）。**手写不引依赖**（与 0.1.3 的 `zip-writer` 对称）：`src/main/services/epub/` 下 `zip-reader.ts`（EOCD + 中央目录 + STORE/DEFLATE + data descriptor；**尺寸与名字以中央目录为准，只有「数据从哪儿开始」用本地头自己的长度算**；Zip64/分卷/加密/其它压缩算法一律抛中文 `ZipError`）、`xml.ts`（lenient XML：`nodes` 数组按**文档顺序**保存元素与文字以支持混合内容；无命名空间语义，配对用 `localName` 大小写不敏感；实体解命名/十进制/十六进制；CDATA、注释、DOCTYPE、闭合错乱都能恢复；多顶层元素或纯文字包成合成 `#document`）、`ocf.ts`（container.xml → OPF，缺失或路径写错时兜底扫包内第一个 `.opf`）、`opf.ts`（metadata/manifest/spine，跳过 `linear="no"` 与悬空 idref；EPUB3 nav 与 EPUB2 NCX 都认）、`xhtml-text.ts`（块级落段、行内接字、`<br>` 断段、跳过 script/style/rt、图片落 **U+FFFC** 占位并记偏移、SVG 整块当一个图；输出形状与 TXT 管线一致：段落间恰好一个 `\n`、无空段）、`toc.ts`（nav 与 NCX 归一成 `{title, path, fragment, depth}`）、`chapters.ts`（`buildEpubContent`：连续正文 + **恰好切分正文**的章节表 + 图片全局偏移）。**两个真书驱动出的关键设计**：① 目录层级取到第 2 层并过滤「一/二/三」页码项（《莫言作品全集》目录深 4 层、顶层仅 18 册太粗、最深一层是页码）；② **目录的文件映射不可靠**（《多情剑客无情剑》把第五～七章指向了下一个文件，正文里却在当前文件）→ 加「全书标题索引」兜底：先在目录给的文件里找（`#片段` → 标题文字，比较前去掉所有空白以兼容全角空格），找不到再全局按标题捞（优先不早于该文件的那次出现），修复后 90 章齐全。另：超长章退回 TXT 切章规则**只用于没有目录的兜底路径**（有真标题的 5 万字章不该被切碎）。真书验收：古龙 445,375 字 / 90 章 / 88ms；莫言 4,585,899 字 / 328 章 / 304ms；两本都「章节表无缝覆盖正文」。 |
| 2026-10-07 | 0.1.5：检查更新（**只提示不下载**，用户 2026-10-07 拍板）。纯函数 `src/shared/core/update.ts`（`parseVersion` 吃 `v` 前缀与后缀、`isNewerVersion` 按数字段比较、`versionFromTag`），主进程 `src/main/services/update.ts` 的 `UpdateService`：`check()` 拉 `https://api.github.com/repos/Guflinn/12read/releases?per_page=1` 比版本，返回三态 `{ outcome: 'update' | 'latest' | 'failed', info }`（**用列表接口而非 `/releases/latest`，因为后者只认非 Pre-release，而我们的发布一律勾 Pre-release**）；`fetchJson` 走 `net.fetch` —— Chromium 网络栈会跟随系统代理，所以开着代理工具时无需在应用里另配（0.1.5 实测 `resolveProxy` → `PROXY 127.0.0.1:7890`、`api.github.com` 200）；10 秒超时、任何异常都归 `failed`，**绝不抛给界面**。`open(url)` 只放行 `https://github.com/` 前缀（schema 与 main 双层校验；这是本应用唯一的外链出口，TECH.md 4.2）。渲染层 `ShelfView` 挂载时静默查一次（模块级 `autoCheckedOnce`，从阅读器回书架不重复请求），左下角 `.app-footer` 里是版本号 + 「检查更新」+（有新版时）「有新版本 vX.Y.Z · 去下载」胶囊；手动检查按三态给不同 toast。更新源可用 `TWELVE_READ_UPDATE_FEED` 覆盖（e2e 用本地假源验证「有新版」与「不误报」两条）。 |
| 2026-10-07 | 0.1.4：阅读统计增强三条（用户 2026-10-07 拍板）。① **书架直接显示今天读数**：`ShelfView` 挂载时取一次 `stat:get(1)`（从阅读器回来会重新挂载，不必订阅），文案由纯函数 `todayReadText(ms, goalMinutes)` 生成 —— 没读又没设目标时返回空串，那行不显示；② **每日目标**：`ReaderSettings.dailyGoalMinutes`（0 = 关，默认 0，zod `default(0)` 兼容旧设置），设置面板 `#goal-{0,15,30,60}` 四个档，纯函数 `goalProgress(ms, goal)` 出 `{ on, reached, percent }`，书架那行与统计面板「今天」卡的进度条都用它，**不做系统通知 / 托盘提醒**；③ **日历视图**：新通道 `stat:calendar`（args `{ month: 'YYYY-MM' }`，正则校验）→ `ReadingStatsService.calendar()` 用新增的仓储查询 `between(fromDay, toDay)`（闭区间）+ 复用 `fillDays` 补齐整月并给出 `maxMs`；渲染层纯函数 `monthCells()`（**周一开始**，前后补白格凑满整周）、`heatLevel(ms, maxMs)` 分 0..4 档、`shiftMonth()` 翻页（当前月不能往未来翻）。**schema 无变化**（沿用 v3）。 |
| 2026-10-07 | 0.1.4：阅读统计的「字数」改口径（用户报「来回刷你，就相当于我读了好几万字」）。旧算法在渲染层按进度落点的位移累加（`reader` store 的 `noteReadChars`），只有「往回翻（step ≤ 0）」与「单步 > 5000 字」不加 —— 于是**来回刷会重复计**（往回翻不加但基准点跟着退，再前进又加一遍），拖滚动条略过的整段也因为每步都不大而被计入。改法：**字数移到主进程算**。渲染层只在「停下 ≥ `STAT_READ_PAUSE_MS`(2000ms)」时报位置（`ReaderView` 第三个计时器 → store 的 `readPaused()` → 通道 `stat:read`），主进程 `ReadingStatsService.readAt()` 按 `reading_span` 的**当天水位线**算增量：新表 `reading_span(book_id, day, chapter_index, max_offset)`（schema v3，纯加表），纯函数 `charsReadStep(mark, offset)` 只在 `0 < offset - mark ≤ STAT_MAX_STEP_CHARS` 时给值 —— 同一段当天只算一次、跳转不计也**不抬水位线**（之后真读到还算得到）；`enteredAt`（进入该章的位置）用于当天第一次碰这一章时给水位线定起点，避免从目录跳进章中间把前半章算成读过。`flushStats()` 此后只报时长（`addReadingStat` 的 chars 恒为 0）；备份清单 `counts` 增加 `spans`。回归：单测 `charsReadStep` 4 例 + `readAt` 6 例（含「来回刷十遍仍只算 800」）+ 迁移 v2→v3 + 契约/ipc 正反例；e2e「同一段来回刷，今天读的字数不会跟着涨」——**把 `spanMark` 临时改成恒返回 null（等价旧行为）该用例失败，恢复后通过**。 |
| 2026-10-07 | 0.1.4：修「回到上次位置」在快滑场景下回不去（用户报：刚打开书 → 快速拖到最底下 → 点「上次位置」没反应）。根因：`settleBookmark` 原来只要「停够 `BOOKMARK_REST_MS`(1.2s)」就更新「上次位置」，而「拖到底 → 松手 → 移鼠标点按钮」这段时间通常已超过 1.2 秒，于是目标被改写成刚滑到的位置，点击等于原地不动。修法：`reader` store 加模块级「停留候选」`dwell = { chapterIndex, offset, since }` 与 `noteDwell()`（换章、或同章挪动 ≥ `BOOKMARK_MIN_GAP_CHARS`(100) 就重开计时），`settleBookmark()` 必须通过 `hasDwelled()` —— 停留 ≥ **`BOOKMARK_DWELL_MS`(5000)** 才认；`BOOKMARK_REST_MS` 退化为「确认滚动停稳」。`ReaderView` 的滚动回调同时挂两个计时器（1.2s 先试一次、5s 再试一次，都调 `settleBookmark`，是否生效由 store 判），卸载时都清理。同时把「回到上次位置」从单槽 swap 改成**双槽**：`bookmark` = 上次读到的位置（点击不再把它换走），新增 `returnSpot` = 刚才离开的位置；`backToBookmark()` 在「人已站在 `bookmark` 上」时回 `returnSpot`，否则回 `bookmark`。`open()` / `leave()` / `applyChapterEdit()` 都清 `dwell` 与 `returnSpot`。回归证据：单测新增「只快滑过去不顶掉」「待够才认 + 同章微移不重开计时」「两槽互不覆盖」；e2e 新增「刚打开就快滑到底仍能回到打开处」——**把阈值临时改成 0 复现旧行为时该用例失败，改回 5000 通过**。 |
| 2026-10-07 | 0.1.4：窗口尺寸 / 位置记忆。纯函数 `src/shared/core/window-bounds.ts`：`parseWindowState()` 对 meta 里的 JSON 做防御式解析（形状不对当没存过），`resolveWindowBounds(state, displays)` 三条规则 —— ① 没存过 → 默认 1180×800、位置交给系统居中（不写 x/y）；② 坐标已失效（与任一屏幕工作区重叠不足 120×40，或标题栏被顶到屏幕上边之外）→ 保留夹取后的尺寸、丢位置交给系统居中（避免「窗口开了但看不见」）；③ 尺寸一律夹到 `[760×540, 最大屏]`。主进程 `src/main/services/window-state.ts` 的 `WindowStateStore` 把状态存进 **meta 表的 `window_state` 键**（与阅读设置同一张表、同一套机制，不新增数据文件）；`captureWindowState(win)` 用 `getNormalBounds()` —— 最大化时也能拿到「还原后」的尺寸，另记 `isMaximized()`。`window.ts` 的 `createMainWindow(state)` 在建窗前取一次 `screen.getAllDisplays()`，`minWidth/minHeight` 改从 core 常量取（避免与窗口尺寸校验两处漂移）；`index.ts` 的 `bootstrap()` 改为返回「开窗函数」，窗口 `close` 时写一次状态（**不做 resize / move 防抖**，代价是进程被强杀时丢本次调整）。 |
| 2026 | 首版。形态决策由 MVP.md 第 1 节的「Web/PWA，后续可套 Tauri 壳」改为「Electron 桌面应用，核心保持平台无关」。 |
| 2026-10-04 | 0.1.3：章节内 + 全书搜索。纯函数在 `src/shared/core/search.ts`（`normalizeQuery` / `findMatches` / `contextAround` / `chapterMatches`，大小写不敏感、非重叠、从左到右），主进程 `src/main/services/search.ts` 的 `BookSearchService` 逐章 `readChapter` 扫正文并逐章 yield 事件循环；通道 `book:search`（scope ∈ chapter / book），渲染层 `SearchPanel.tsx` 320ms 防抖、Ctrl/Cmd+F 开面板、命中跳转后段落闪 1.6s。**不用 SQLite FTS5**：unicode61 对中文不切词，trigram 只支持 3 字以上查询，且 851 万字的书要建两千万级三元组；正文已有 64MB LRU 缓存，逐章 indexOf 是百毫秒级。**阅读与搜索必须共用同一个 `FileContentReader` 实例**（`src/main/index.ts`），否则 64MB 缓存变两份。 |
| 2026-10-04 | 0.1.3：书签与划线（schema v2 迁移）。`src/main/db/schema-v2.ts` 建 `bookmark` / `highlight` / `reading_stat` 与三个索引，`annotations-repository.ts` 提供读写；新增 `bookmark:list/add/remove`、`highlight:list/add/remove` 六个通道；渲染层 `core/annotations.ts` 放纯函数（`splitHighlighted` 把章内偏移切成划线片段、`excerptAt`、`normalizeSelection`），目录抽屉拆成目录 / 书签 / 划线三页。 |
| 2026-10-04 | 0.1.3：阅读统计。新表 `reading_stat(book_id, day, ms, chars, updated_at)`（主键 `(book_id, day)`，写入走 `ON CONFLICT ... DO UPDATE SET ms = ms + excluded.ms`），`ReadingStatRepository` 出汇总（`totals` / `since` / `days` / `topBooks`，本数用 `COUNT(DISTINCT book_id)`），`ReadingStatsService` 按**本地日期**（`dayKey`）落行、`fillDays` 把没读的日子补成 0；通道 `stat:add` / `stat:get`。渲染层 `core/reading-clock.ts` 的 `createReadingClock` 每 15 秒记一段，只算「窗口可见 + 60 秒内有活动」（`document.visibilityState` / `hasFocus` + keydown / pointerdown / wheel）；`reader` store 把同章前进的章内偏移差累成字数（跳章、往回翻、单步超过 5000 字都不算），书架 `#btn-stats` 打开 `StatsSheet`（今天 / 累计 / 连续天数 + 近 14 天柱状 + 读得最多的 5 本）。 |
| 2026-10-04 | 0.1.3：导出备份。**不引新依赖**，`src/main/services/zip-writer.ts` 手写 ZIP（本地头 / 中央目录 / EOCD，自算 CRC32 查表，逐条 `zlib.deflateRaw` 异步压缩、压不小就退回 STORE，文件名恒置 UTF-8 位 `0x0800`，不做 Zip64 因为单文件远小于 4GB，条目上限 `0xffff`）。`src/main/services/backup.ts` 的 `BackupService.collect()` 按固定顺序装包：先用 `VACUUM INTO` 导出临时快照（一致性，且天然覆盖 `book` / `chapter` / `progress` / `bookmark` / `highlight` / `reading_stat` 全部表）当 `library.db`；再按 `listBooks()` 顺序逐本读 `books/<id>/source.bin`（**一本一本读，不把整个书库摊在内存里**，缺文件不报错只在清单里记 `hasSource: false`）；最后放 `12read-backup.json`（文件名由 `layout.ts` 的 `BACKUP_MANIFEST_FILE` 定下，含 app / version / schemaVersion / exportedAt / 六张表的 counts / 每本书的 id+title+author）。派生的 `content.txt` 与 `chapters/NNNN.txt` 不进包。通道 `backup:export` 走 `emptyArgsSchema`，主进程弹 `dialog.showSaveDialog`（默认名 `十二阅读备份-YYYYMMDD.zip`），取消返回 `null`，成功返回 `BackupResult { path, bytes, books }`；书架 `#btn-export` 导出中禁用并 toast。 |
| 2026-10-04 | 0.1.3：正文字体（`--font-body`）与栏宽（`--page-w`）可选；阅读器 ← / → 翻一屏、Ctrl + ← / → 切章；新增 `book:redecode` 手动指定编码重解码（含手工 `big5` 分支）。 |
| 2026-10-04 | 0.1.3：手动改分章（`chapter:rename` / `chapter:merge` + `ChapterEditor`）：正文一字不动，只重写章节表，进度按编辑前的绝对字符位置重新落位。发布前按用户反馈删掉了顶栏「拆分」：在当前位置把本章拆两节这件事用户实际不做，留着只是干扰。 |
| 2026-10-04 | 0.1.3：大书专项（性能实测 + 修一处还原卡死）。用 851 万字 / 41 节的靶子书实测：导入 348ms、打开到首个段落 355–449ms、切章 52–60ms、滚完 58 万字的第一章 18 轮 2998–3054ms（最慢一轮 94ms）、主进程 heapUsed 38.2MB / rss 148.8MB、渲染进程 JS 堆 57.5–73.1MB、全书搜「方源」447ms、冷启动到书架 579–639ms —— 全在预算内，没有明显瓶颈。**期间修掉「进度落在长章节深处时重开只还原到 977 段（约 4 万字）就永远停住」**：首屏只铺 `CHUNK_FIRST_RENDER_CHARS`（20000 字），`scrollTopForOffset` 对超出已渲染范围的目标只能给到最后一段的位置，随之而来的滚动事件又把 `lastOffsetRef` 改写成这个被夹住的值，于是下一轮 `desired` 已到位、不再触发滚动，而自动续铺只在离底部 600px（`AUTOLOAD_REMAINING_PX`）内触发 → 链条断开（凡超过 5 万字的章节都中招，书签与同章搜索命中跳转走同一条路）。修法：`reader` store 新增 `revealTo(offset)`，一次铺到「目标 + 一屏」（铺够就不动，注释里写明「一格一格 revealMore 要来回几十轮，且人停在半路会卡死」）；`ReaderView` 的定位 effect 在 `truncated && desired >= visibleChars` 时先 `revealTo(desired)` 再 `return`（这一轮不滚），依赖数组补上 truncated / visibleChars。回归证据 `tests/e2e/large-book.spec.ts`：自造 4 章 × 36 万字（每章 6200 段），覆盖分块首屏 → 滚到章尾 → 离开后重开回到原处（192ms 回到 6200 段）→ 章内搜索命中跳转定位。 |
| 2026-10-04 | 0.1.2：阅读器顶栏加独立的日/夜间切换按钮；新增「上次位置」书签（`reader` store 的 `bookmark` + `settleBookmark` / `backToBookmark`，来回切换靠「把当前位置换进书签」）；`ReaderSettings` 增加 `bold`，加粗写 `--fw`（schema 用 `default(false)`，0.1.1 的旧设置不会整份回退默认）。 |
| 2026-10-03 | 0.1.1：主题与排版变量从 `.app` 上移到 `<html>`（原来 `body` 取不到夜间变量，整页花屏）；`book:list` 返回 `ShelfBook[]`（带 `percent`，一次 LEFT JOIN，取代书架 N+1）；大章节续渲染由「一次全给」改为每次 2 万字。 |

## 1. 形态决策：Electron

### 1.1 结论

做成 Electron 桌面应用。但核心不绑定 Electron —— 业务代码、UI、解码、切分全部平台无关，Electron 只是最外层的壳。

### 1.2 选 Electron 的实际理由

| 理由 | 说明 |
| --- | --- |
| 正文不进浏览器存储 | 书库落在 userData 目录，不受 IndexedDB 配额与「存储压力下被驱逐」影响。这是自用场景最容易踩的隐形坑。 |
| 编码覆盖更宽 | iconv-lite 覆盖 gbk / gb18030 / big5 / utf-16 等，比浏览器 TextDecoder 的可用集合更宽，且能在 Node 侧做统计检测。 |
| 渲染一致性 | 自带 Chromium，中文换行、字体回退、滚动行为在三平台一致。排版是阅读器的核心体验，不宜赌系统 WebView。 |
| 后路完整 | 托盘、全局快捷键、置顶迷你窗、多窗口都是后续「第二次阅读」的天然能力，不需要换栈。 |
| 正文按需读取 | 可从磁盘按章读取，不必一次性把整本书搬进内存。 |

### 1.3 代价（如实记录）

- 安装包 80–150MB；空载内存基线 150–250MB
- 需要处理打包、签名、三平台构建；自动更新本版不做，但占规划
- 原生模块（better-sqlite3）需要 @electron/rebuild 参与构建链

这些代价在 MVP 阶段换不会收益的大头，属于**提前支付**。接受的理由是：桌面形态就是产品的最终形态，这笔账早晚要付。

### 1.4 决策记录：为什么不是 Tauri

| 维度 | Electron（选） | Tauri（备选） |
| --- | --- | --- |
| 安装包 | 80–150MB | 5–15MB |
| 内存 | 偏高 | 低 |
| 渲染一致性 | 完全一致（自带 Chromium） | 依赖系统 WebView，三平台有差异 |
| 实现成本 | 低，前端一人可完成 | 需要 Rust |
| 中文排版可控性 | 高 | 中 |

选 Electron 是**用体积换确定性**。MVP 要验证的是阅读体验，不是打包艺术。Rust 侧的 encoding_rs / rusqlite 更优雅，但会给 M0–M2 增加一条学习曲线，而这条曲线对成功标准（读完一本书并恢复位置）零贡献。

### 1.5 什么时候该反悔

出现以下任一情况，重新评估 Tauri：

- 安装包体积成为分发障碍（要公开发布 / 上应用商店）
- 空载内存被实测认为不可接受
- 需要 Rust 侧能力（全谱系编码检测、高性能全文索引）

因为第 3 节把平台能力全部收在接口后面，**换壳只改一个实现文件，不动业务代码** —— 这是本次决策可逆的前提。

## 2. 架构总览

~~~
┌──────────────────────────────────────────────────────────────┐
│ Renderer (Chromium, sandbox: true)                           │
│   React + Zustand                                            │
│   ├─ core/      纯函数：编码判定 / 章节切分 / 锚点定位 / 文件名清洗  │
│   ├─ ui/        书架 · 阅读器 · 目录抽屉 · 设置                  │
│   └─ platform/  全应用仅此一处调用 window.reader.*              │
└───────────────────────────┬──────────────────────────────────┘
                            │ contextBridge：window.reader（白名单）
┌───────────────────────────┴──────────────────────────────────┐
│ Preload (sandboxed)                                          │
│   参数校验（zod）+ 通道转发 + 事件订阅                          │
└───────────────────────────┬──────────────────────────────────┘
                            │ ipcRenderer.invoke ⇄ ipcMain.handle
┌───────────────────────────┴──────────────────────────────────┐
│ Main (Node)                                                  │
│   ├─ services/    import · library · progress · files        │
│   ├─ db/          SQLite + migrations                        │
│   ├─ workers/     decode.worker.ts（worker_threads）          │
│   └─ platform/    FileGateway / BookRepository 的 Electron 实现 │
└──────────────────────────────────────────────────────────────┘
~~~

### 2.1 三条铁律

1. **Renderer 不碰 fs、不碰 ipcRenderer 原始对象、不碰任何 Node API。** 只能调用 preload 经 contextBridge 暴露的 window.reader。
2. **Renderer 只传 bookId，不传路径。** 所有路径由 main 依据 bookId 拼接，从根上消除路径穿越。
3. **core/ 目录不得 import 任何 Electron 或 Node 模块。** 它是纯函数，能在浏览器、Node、Worker 任意环境运行，也是单测的主战场。

## 3. 平台抽象层（本文档的关键增量）

三个接口，定义在 src/shared/ports.ts，不依赖任何运行时。

~~~ts
export interface Importer {
  /** 用户选择文件；返回绝对路径。Electron 侧走 dialog.showOpenDialog */
  pick(): Promise<string[]>;
  /** 读字节 → 检测编码 → 解码 → 切分 → 落库。可取消、可报进度 */
  import(
    filePath: string,
    onProgress: (p: ImportProgress) => void,
    signal?: AbortSignal,
  ): Promise<Book>;
}

export interface Library {
  list(): Promise<ShelfBook[]>; // ShelfBook = Book + percent（0..100）
  get(bookId: string): Promise<Book | null>;
  rename(bookId: string, title: string): Promise<Book>;
  remove(bookId: string): Promise<void>;
  chapters(bookId: string): Promise<Chapter[]>;
}

export interface ContentReader {
  /** 读取第 index 章正文（已解码的字符串） */
  readChapter(bookId: string, index: number): Promise<string>;
}

export interface ProgressStore {
  get(bookId: string): Promise<Progress | null>;
  save(p: Progress): Promise<void>;
}

export interface Ports {
  importer: Importer;
  library: Library;
  content: ContentReader;
  progress: ProgressStore;
}
~~~

- `Library.list()` 返回 `ShelfBook[]`：书架一次查询就连同进度拿全，renderer 不再逐本 `progress:get`（N+1 → 1）。
- Electron 实现：src/main/platform/electron/*
- 将来 Web / PWA 实现：IndexedDB + File API，接口不变
- 将来 Tauri 实现：invoke 到 Rust，接口不变

**测试价值**：core 的单测注入内存实现即可，完全不必启动 Electron。

## 4. 进程与 IPC

### 4.1 通道清单

| 通道 | 方向 | 入参 | 返回 | 备注 |
| --- | --- | --- | --- | --- |
| file:pick | R→M | 无 | string[] | 用户取消返回空数组 |
| book:import | R→M | path | Book | 长任务，见 4.3 |
| book:list | R→M | 无 | ShelfBook[] | 按 lastOpenedAt 倒序；LEFT JOIN progress 带出 percent |
| book:get | R→M | bookId | Book 或 null | |
| book:rename | R→M | bookId, title | Book | title 清洗后非空 |
| book:delete | R→M | bookId | void | 级联删进度记录与正文目录 |
| book:redecode | R→M | bookId, encoding | Book | encoding ∈ auto / utf-8 / gb18030 / big5 / utf-16le / utf-16be；复用 source.bin 重解，清掉该书进度 |
| book:chapters | R→M | bookId | Chapter[] | 不含正文 |
| chapter:read | R→M | bookId, index | string | |
| chapter:rename | R→M | bookId, index, title | Chapter[] | 只改标题；title 去空白后 1..120 |
| chapter:merge | R→M | bookId, index | Chapter[] | 把 index+1 章并进 index 章（标题沿用前者）；最后一章报错 |
| bookmark:list | R→M | bookId | Bookmark[] | 按 chapterIndex → charOffset → createdAt 排序 |
| bookmark:add | R→M | bookId, chapterIndex, charOffset, excerpt | Bookmark | excerpt 是偏移前后 24 字，连续空白折成一个空格；id 与 createdAt 由主进程生成 |
| bookmark:remove | R→M | id | void | 重复删不报错 |
| highlight:list | R→M | bookId | Highlight[] | 按 chapterIndex → startOffset 排序 |
| highlight:add | R→M | bookId, chapterIndex, startOffset, endOffset, text | Highlight | endOffset 必须大于 startOffset；text 最多 2000 字，note 恒为 null（笔记不做） |
| highlight:remove | R→M | id | void | 重复删不报错 |
| book:search | R→M | bookId, query, scope, chapterIndex | SearchResult | scope ∈ chapter / book；query trim 后 1..80 字；直接扫正文（不用 FTS5，见变更记录），每章最多 30 条、全书最多 200 条，命中总量 `total` 可能大于列出的 `hits.length`（每章上限也会触发 truncated） |
| stat:read | R→M | bookId, chapterIndex, charOffset, enteredAt | number | 0.1.4：报「停下读过」的位置；字数由 main 按当天每章的水位线去重后算，返回这次记了多少字。charOffset / enteredAt ≤ 10^7（防呆） |
| book:images | R→M | bookId | BookImage[] | 0.2.0：书的内联图片清单（偏移 → `reader-image://` 地址）。字节不走 IPC，另注册自定义协议按需取 |
| update:check | R→M | 无 | UpdateCheckResult | 0.1.5：拉远端最新 Release（`per_page=1`，含 Pre-release）比版本号；三态 `update` / `latest` / `failed`，失败静默 |
| update:open | R→M | url | void | 0.1.5：用系统浏览器打开下载页。**只放 `https://github.com/` 开头的地址**（schema 与 main 各验一次），其余一律忽略 |
| stat:calendar | R→M | month | ReadingCalendar | 0.1.4：某个自然月每天的阅读量（整月补齐 0）+ 当月峰值，给日历视图用；month 必须是 `'YYYY-MM'` |
| progress:get | R→M | bookId | Progress 或 null | |
| progress:save | R→M | Progress | void | renderer 侧节流 500ms |
| task:cancel | R→M | taskId | void | 取消导入 |
| import:progress | M→R | ImportProgress | 无 | webContents.send 事件流 |

### 4.2 安全基线

- BrowserWindow: contextIsolation: true，nodeIntegration: false，sandbox: true，webSecurity: true
- preload 只暴露 window.reader，方法白名单穷举，不透传 ipcRenderer
- 每个通道入参用 zod 校验；失败即拒绝并记日志，不静默
- 所有 bookId 校验格式（uuid v4），路径一律由 main 拼接
- setWindowOpenHandler 一律 deny；will-navigate 拦截非本地 URL
- CSP：default-src 'self'；script-src 'self'；style-src 'self' 'unsafe-inline'；img-src 'self' data:；connect-src 'none'
- 本版无任何网络请求

### 4.3 长任务与取消

导入 50MB 文件可能耗时十几秒，不能占死 main 的事件循环：

- 解码 + 切分跑在 worker_threads（src/main/workers/decode.worker.ts）
- import 分配 taskId，进度经 import:progress 推给 renderer
- task:cancel 把 AbortSignal 传到 worker
- worker 崩溃时 main 捕获并返回结构化错误，renderer 显示可读文案，绝不白屏

## 5. 数据层

### 5.1 存储分工

| 数据 | 位置 | 理由 |
| --- | --- | --- |
| 元数据与进度 | SQLite（better-sqlite3） | 事务、索引、迁移 |
| 原始字节 | 文件系统 source.bin | 唯一事实来源，永不改写 |
| 解码结果 | 文件系统 content.txt（缓存） | 可随时删除重建 |
| 超长书的分章 | chapters/NNNN.txt | O(1) 章节读取 |

**为什么保留原始字节**：MVP 不做「手动指定编码重解码」，但它是 Backlog 第 4 项；重新解码需要原始字节，删掉不可恢复。原始字节只存一份，成本可接受。

**偏移量语义（必须写死）**：startOffset 与 charOffset 都是**解码后文本的 UTF-16 code unit 偏移**，不是字节偏移。中文全在 BMP，一个汉字算 1；emoji 等代理对算 2。所有涉及偏移的代码必须遵守，并在单测里固定住。

### 5.2 目录布局（userData）

~~~
%APPDATA%/12read/
  library.db  (+ -wal, -shm)
  books/
    <bookId>/
      source.bin          原始字节
      content.txt         UTF-8 解码缓存（single 模式）
      chapters/0000.txt   分章文件（sliced 模式）
~~~

### 5.3 单文件 vs 分章

| 模式 | 触发条件 | 读取方式 |
| --- | --- | --- |
| single | 源文件 ≤ 32MB | main 侧 LRU 缓存解码结果（上限 64MB），按偏移 slice |
| sliced | 源文件 > 32MB | 导入时按章切文件，读取直接读对应文件 |

32MB 是经验阈值，放进配置可调。MVP 典型书 5MB，走 single。

### 5.4 Schema（v1）

~~~sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE book (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  author         TEXT,
  format         TEXT NOT NULL DEFAULT 'txt',   -- 预留 epub，见 MVP 第 7 节
  encoding       TEXT NOT NULL,
  byte_size      INTEGER NOT NULL,
  char_count     INTEGER NOT NULL,              -- UTF-16 code units
  chapter_count  INTEGER NOT NULL,
  content_mode   TEXT NOT NULL,                 -- single | sliced
  cover_seed     INTEGER NOT NULL,
  added_at       INTEGER NOT NULL,
  last_opened_at INTEGER
);

CREATE TABLE chapter (
  book_id      TEXT    NOT NULL REFERENCES book(id) ON DELETE CASCADE,
  idx          INTEGER NOT NULL,
  title        TEXT    NOT NULL,
  start_offset INTEGER NOT NULL,   -- 解码后文本的 UTF-16 偏移
  char_length  INTEGER NOT NULL,
  kind         TEXT    NOT NULL,   -- chapter | segment
  PRIMARY KEY (book_id, idx)
);

CREATE TABLE progress (
  book_id       TEXT PRIMARY KEY REFERENCES book(id) ON DELETE CASCADE,
  chapter_index INTEGER NOT NULL,
  char_offset   INTEGER NOT NULL,  -- 章内相对偏移
  anchor_before TEXT,              -- 前 30 字引文
  anchor_after  TEXT,              -- 后 30 字引文
  percent       REAL    NOT NULL,
  updated_at    INTEGER NOT NULL,
  device_id     TEXT               -- 为同步预留，本版不实现
);

CREATE INDEX idx_book_recent ON book(last_opened_at DESC);
~~~

两处相对 MVP 第 7 节的**新增**，都属于「现在不做、以后要迁移用户数据」的类型，所以现在就落库：

- **chapter.kind**：区分「章节」与「定长分段」。MVP 第 8 节坑 4 要求文案上区分，用数据字段表达比运行时判断可靠。
- **progress.anchor_before / anchor_after**：MVP 第 8 节坑 1 提到的引文锚点，字段现在就存，哪怕 M2 暂不消费。

### 5.5 迁移

- meta['schema_version'] 记录版本；启动时顺序执行 migrations，整体事务包裹
- 每次迁移要写明回滚方式（即使只写在注释里）
- 迁移前把 library.db 复制为 library.db.bak-<version>

## 6. 编码识别与解码

### 6.1 流程

1. **二进制判定**：前 8KB 出现 NUL 字节，或不可打印字符占比 > 30%，判为二进制，报「这不是一个纯文本文件」并终止
2. **BOM**：EF BB BF → utf-8；FF FE → utf-16le；FE FF → utf-16be
3. **严格 UTF-8**：对样本（前 256KB）用 TextDecoder('utf-8', { fatal: true })；不抛异常则整文件按 UTF-8 解码
4. **回退 GB18030**：iconv-lite 按 gb18030 解码（GBK 的超集，覆盖更全）
5. **结果体检**：统计替换字符 U+FFFD 与私用区字符占比；异常则记 encoding 为 unknown，并在导入结果里附警告
6. 任何一步失败都给明确提示，绝不白屏（对应 MVP 第 11 节的「错误处理」）

### 6.2 执行位置

全部在 worker_threads 内完成，main 只负责 IO 与落库。样本判定与全量解码都不在主线程。

### 6.3 验收

- GBK 中文 TXT 导入不乱码
- UTF-8 有 BOM / 无 BOM 均正确
- UTF-16LE 带 BOM 能识别
- 二进制文件（例如误选 .jpg）给出明确错误
- 以上每条都有单测夹具

## 7. 章节切分

### 7.1 正则（沿用 MVP 第 3.2 节）

~~~
^\s*第\s*[0-9零一二三四五六七八九十百千万两]+\s*[章节回卷部篇集]
^\s*(序章|楔子|序言|前言|引子|后记|尾声|终章|番外)
~~~

### 7.2 三条补充规则（防止误切）

1. **整行匹配**：必须独占一行，前后无其它文字
2. **行长上限**：命中行长度 ≤ 40 字符。正文里「第三章的内容他讲了很多……」这类长句不应被当作标题
3. **单调递增保护**：按行号顺序推进，同一位置不重复起章

### 7.3 兜底

- 正则命中数 < 2（等于没切出章节）时，按目标 4000 字定长分片，区间 3000–5000，并尽量在段落边界（空行或行尾）切
- 兜底分片的 kind 记为 segment，UI 文案必须显示「分段 N」而不是「第 N 章」（MVP 第 8 节坑 4）

### 7.4 复杂度与验收

- 一次线性扫描，O(n)；250 万字约 250 万次行匹配，需实测在 worker 内 < 1s
- 单测夹具：无章节纯文本、章节密集、章节稀疏、含干扰长句、CRLF、标题带空格、中英混排

## 8. 阅读器渲染与性能

### 8.1 只渲染当前章

- DOM 中永远只有当前章。切章 = 换内容 + 重置滚动
- 跨章衔接：上一章末尾与下一章开头先取好，避免白屏（对应 MVP 第 8 节坑 2）
- 大章节保护：单章 > 5 万字时启用分块渲染（先渲染前 2 万字，滚到阈值再 `+2 万字` 逐步追加，避免一次把几十万字挂进 DOM）

### 8.2 排版

- 字号、行距、字重、主题全部走 CSS 变量（--fs / --lh / --fw / --theme-*），切换只改根节点属性，React 不重渲染正文。字重只作用到 `.reader-content p`，章标题保持自己的 600
- 变量与 `data-theme` 写在 `document.documentElement`（`<html>`）上，见 `src/renderer/src/core/theme.ts` 的 `applyTheme(settings, root)`；写在 `.app` 内部会让 `body` 拿不到夜间配色（深底压深字）
- 重排后的位置保持见第 9 节锚点重定位

### 8.3 性能指标（M3 验收）

| 指标 | 目标 |
| --- | --- |
| 导入 5MB / 250 万字（解码+切分） | < 2s |
| 导入 50MB | < 15s，可取消，有进度 |
| 切章（读盘 + 渲染） | < 100ms |
| 调字号后重排并重定位 | < 50ms，位置偏差 ≤ 1 行 |
| 冷启动到书架可用 | < 2s |
| 空闲常驻内存 | < 250MB |

## 9. 进度与锚点（改动成本最高的地基）

### 9.1 存什么

- chapterIndex + charOffset：主锚点，章内相对偏移
- anchorBefore / anchorAfter：前 30 字 + 后 30 字引文，兜底锚点
- percent：冗余的展示值，不参与定位
- deviceId：为同步预留，本版写死本机 id

### 9.2 写入时机

- 滚动事件节流 500ms 写一次（renderer 侧），只传增量
- 以下时机强制 flush：切章、切后台（visibilitychange）、窗口 blur、退出前（before-quit 与 will-quit）
- 退出前的 flush 用同步通道保底，避免进程先退出导致丢位置

### 9.3 重定位算法

1. **优先**：在当前章文本里搜索 anchorBefore + anchorAfter 的组合，命中即定位
2. **退化**：直接用 charOffset，并做上下界夹取
3. **再退化**：定位到章首，percent 仍用于书架展示
4. 章节结构变化导致完全对不上时，用 percent 估算落点

排版变化（字号、行距、窗口宽度）**不得**触发重写 charOffset，只重定位滚动位置。

## 10. 安全

第 4.2 节已列基线，此处补三条产品级约束：

- 应用不发任何网络请求；connect-src 'none' 是硬约束，不是建议
- 书库目录之外的路径一律拒绝访问，不提供「打开任意路径」
- 删除书籍时先删库记录再删目录；目录删除失败不阻塞 UI，但要记日志（孤儿目录留给后续清理）

## 11. 工程与测试

### 11.1 目录结构

~~~
12read/
  package.json
  electron.vite.config.ts
  src/
    main/      主进程：services · db · workers · platform
    preload/   contextBridge 暴露层
    renderer/  React 应用：core · ui · platform
    shared/    ports.ts · types.ts · schema.ts(zod)
  tests/
    unit/      纯函数单测（Vitest）
    contract/  IPC 入参校验正反用例
    e2e/       Playwright + Electron
    fixtures/  小样本 TXT（大文件由脚本生成，不入库）
~~~

### 11.2 工具链

| 层 | 选择 | 理由 |
| --- | --- | --- |
| 构建 | electron-vite + Vite + React + TypeScript | 主/预/渲染三端一套配置，反馈快 |
| 状态 | Zustand | 轻量，够用 |
| 编码 | iconv-lite（可选 jschardet） | 覆盖 GBK / GB18030 / Big5 / UTF-16 |
| 数据库 | better-sqlite3 | 同步 API 简单，需 @electron/rebuild |
| 校验 | zod | 同一份 schema 复用于 IPC 与表单 |
| 纯函数测试 | Vitest | 覆盖编码判定、章节切分、锚点定位、文件名清洗 |
| 端到端 | Playwright（_electron.launch） | 覆盖导入 → 阅读 → 切章 → 调字号 → 重启恢复 |
| 代码规范 | ESLint + Prettier + tsc --noEmit | CI 门禁 |

### 11.3 测试分层与门槛

| 层 | 覆盖 | 门槛 |
| --- | --- | --- |
| unit | core 全部纯函数 | 行覆盖 ≥ 90% |
| contract | 每个 IPC 通道的合法与非法入参 | 100% 通道有反例 |
| e2e | MVP 第 3 节 P0 五块的验收标准 | 全绿方可交付 |

### 11.4 按仓库 AGENTS.md 的执行要求

- 每次改动后更新对应测试并全部跑通，再创建 commit
- commit 粒度：一个可解释的改动一个 commit；重构与功能分开
- 提交前门禁：lint + tsc + vitest + playwright

## 12. 打包与分发

- electron-builder，目标 Windows（nsis）与 macOS（dmg）
- 体积目标：安装包 < 120MB
- 自动更新本版不做（MVP 第 4 节已把分发类需求划到不做）
- 签名与公证本版不做，自用场景先本地安装

## 13. 里程碑（对齐 MVP 第 9 节）

| 阶段 | 内容 | 完成标志 |
| --- | --- | --- |
| M0 | electron-vite 骨架 + 三进程 + ports.ts + Vitest + Playwright + lint | 空项目 e2e 能起窗口，单测跑通 |
| M1 | 导入 + 编码识别 + 章节切分 + SQLite 数据层 + worker | 单测覆盖编码与切分的典型/边界用例；GBK 中文不乱码 |
| M2 | 书架 + 阅读界面 + 目录 + 进度保存 | **端到端读完整本 TXT 并恢复位置（可用版本达成）** |
| M3 | 字号/行距/主题 + 空态/错误态 + 大文件性能 | 百万字不卡顿，达到第 8.3 节全部指标 |

## 14. 风险与对策

| 风险 | 对策 |
| --- | --- |
| better-sqlite3 原生模块与 Electron ABI 不匹配 | 构建链固定 @electron/rebuild；CI 从零安装验证 |
| 主进程被解码 / 切分阻塞 | 一律进 worker_threads，main 只做 IO |
| slice 大字符串导致内存翻倍 | single 模式设 LRU 上限；超 32MB 走 sliced |
| 偏移量语义写错（字节 vs code unit） | 用类型别名 CharOffset 明示；单测固定中英 emoji 混排用例 |
| 章节正则误切长句 | 行长上限 + 整行匹配 + 夹具覆盖干扰句 |
| 范围蔓延 | 以 MVP 第 4 节不做清单为准，新需求先写 Backlog |
| Electron 体积 / 内存超预期 | 第 1.5 节保留了换壳路径，接口不变即可迁移 |

## 15. 待决问题

1. 是否提供「原地引用外部文件」模式（不复制进书库）。好处是不占额外空间，代价是用户移动文件即失效。建议本版不提供。
2. 大章节分块渲染的阈值取 5 万字还是按行数。M3 用真实数据定。
3. 是否需要 source.bin 之外的可移植导出格式（导出/备份属 Backlog，但会影响目录设计）。当前设计已保证整个 books/ 目录可直接拷贝迁移。
