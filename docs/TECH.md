# 12read 技术方案（Electron 桌面版）

> 状态：待评审
> 更新时间：2026 年
> 上游文档：[MVP.md](MVP.md) 定义「做什么 / 不做什么」；本文档定义「怎么搭」。
> 范围约束：本文档不扩大 MVP。仍是只做 TXT，仍是 MVP 第 3 节那五块 P0。

## 0. 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026 | 首版。形态决策由 MVP.md 第 1 节的「Web/PWA，后续可套 Tauri 壳」改为「Electron 桌面应用，核心保持平台无关」。 |
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
| book:chapters | R→M | bookId | Chapter[] | 不含正文 |
| chapter:read | R→M | bookId, index | string | |
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
