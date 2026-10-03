# 十二阅读（12read）

本地优先的 TXT 桌面阅读器：导入一本 .txt，从头读到尾，关掉再打开回到原处。
没有账号、没有服务器、不联网——书和进度只存在这台电脑上。

产品范围见 [docs/MVP.md](docs/MVP.md)，技术方案见 [docs/TECH.md](docs/TECH.md)，
界面原型见 [demo/index.html](demo/index.html)（静态演示，带演示数据）。

## 现在能做什么

- **导入**：文件选择器或把 .txt 拖进窗口，支持多选；书名/作者从文件名清洗（`《书名》作者.txt`、`书名(完结).txt`）。
- **编码**：BOM → 严格 UTF-8 → GB18030 兜底；二进制文件直接拒绝并给中文提示，绝不白屏。
- **分章**：识别 `第N章/节/回/卷/部/篇/集` 与 `序章/楔子/前言/番外` 等行；认不出来就按 3000–5000 字分段，界面上会明确写「分段」而不是「章节」。
- **书架**：进度条、最近阅读排序、重命名、删除（连带正文与进度一起删）。
- **阅读**：滚动模式、只渲染当前章、上一章/下一章、目录抽屉（高亮当前节）、字号 15–27、行距三档、日间/夜间。
- **进度**：章序号 + 章内偏移 + 前后各 30 字锚点；改字号/行距只重排版，不改变读到的位置；关掉再打开回到原处。

## 快速开始

需要 Node 20+ 和 pnpm（lockfile 按 pnpm 11 生成）。

```bash
pnpm install          # better-sqlite3 走 N-API 预编译包，不需要本机 MSVC / Python
pnpm dev              # 开发模式（HMR）
```

常用命令：

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 开发模式启动 Electron |
| `pnpm build` | electron-vite 产出 `out/` |
| `pnpm verify` | eslint + 三份 tsconfig 类型检查 + 单测 + 契约测试 |
| `pnpm test:coverage` | 单测覆盖率（行覆盖率门槛 90%） |
| `pnpm test:e2e` | Playwright 驱动真实 Electron（会先自动 build） |
| `pnpm dist` | 打包到 `release/`（`electron-builder --dir`） |

## 数据放在哪

`%APPDATA%/12read`（Windows）、`~/Library/Application Support/12read`（macOS）：

```
library.db               元数据 + 章节 + 进度（SQLite，WAL + 外键）
library.db.bak-<version> 迁移前的自动备份
books/<bookId>/source.bin        原始字节，永不改写（将来重新解码要用）
books/<bookId>/content.txt       解码后的全文（<= 32MB 的书）
books/<bookId>/chapters/NNNN.txt 分章切片（> 32MB 的大书）
```

删书是「先删数据库记录，再删目录」，目录删失败只记日志、不阻塞界面。

## 几个设计要点

- **偏移语义**：所有 `startOffset` / `charOffset` 都是解码后文本的 UTF-16 code unit 偏移，不是字节偏移（中文 1、emoji 2）。这条由单测钉死。
- **位置锚点**：进度主字段是章内偏移，另外存前后 30 字。找回位置的顺序是「组合锚点 → 偏移量 → 本章开头 → 百分比估算」。
- **大章节分块渲染**：超过 5 万字的章只先渲染前 2 万字，滚动接近底部再续，正文永远不会整本进 DOM。
- **安全基线**：renderer 沙箱开启、只能通过 preload 暴露的 `window.reader` 说话；每个 IPC 通道在 main 侧再过一遍 zod；生产环境挂硬性 CSP（`connect-src 'none'`，应用不发任何网络请求）。

## 架构与三条铁律

```
src/main      主进程：IPC、SQLite、解码 worker、文件布局
src/preload   contextBridge 白名单（window.reader）
src/renderer  React + Zustand 界面
src/shared    两端共用：类型、IPC 通道、zod schema、core 纯函数
tests         unit / contract / e2e
```

1. renderer 不碰 `fs`、`ipcRenderer`、Node 模块；
2. renderer 只传 `bookId`，真实路径永远由 main 侧拼；
3. `src/shared/core` 里的纯函数不 import Electron / Node（main 与 renderer 都复用）。

## 测试

- `tests/unit`：纯函数、store、主进程服务（真实 better-sqlite3 + 临时目录）。
- `tests/contract`：IPC 通道清单/接线一致性、zod schema 正负用例。
- `tests/e2e`：Playwright `_electron.launch`，跑「导入 → 阅读 → 切章 → 改字号 → 重启恢复」、GBK 不乱码、二进制被拒三条真实链路。
- 覆盖率门槛 90% 行（见 `vitest.config.ts`；只做真实 Electron 才能跑起来的入口文件，如 `src/main/index.ts`、`src/main/window.ts`、worker 启动脚本，交给 e2e）。

## 打包

```bash
pnpm build && pnpm exec electron-builder --win nsis   # release/twelve-read-setup-<version>.exe
```

`electron-builder.yml` 里 `npmRebuild: false`：better-sqlite3 13 自带各平台 N-API 预编译二进制，不必也不要让 node-gyp 重编译。安装包不签名、不带自动更新。

实测（Windows x64）：`release/twelve-read-setup-0.1.0.exe` 约 98 MB，低于 TECH 的 120 MB 目标；解包目录 `release/win-unpacked` 约 352 MB，体积几乎都在 Electron 运行时（210 MB）与被解包的 better-sqlite3（含各平台 prebuild 与 SQLite 合并源码）上。打包后的 exe 做过冒烟：能建库、能写 `books/`，说明 N-API 预编译二进制在 asar 外正常加载。

## 已知边界

不在这个版本里：书签/笔记/划线、全文搜索、EPUB/PDF/MOBI、账号与云同步、书城、TTS、手动改分章或指定编码、导出备份、分页/全屏/页边距（这些都在 docs/MVP.md 的「暂不做」里）。
其它已知取舍：导入取消目前只对 worker 生效（内联兜底路径不中断）；重排后的位置漂移允许一行以内；外部文件引用模式（只引用不复制）特意没做，避免用户移动源文件后书变空白。

## 里程碑

M0 工程骨架与工具链 → M1 导入/解码/分章/存储 → M2 书架/阅读器/目录/进度 → M3 打磨、覆盖率与端到端验证。
