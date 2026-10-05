# HANDOFF —— 交给另一个 Agent 接着做

> 本文件是**跨 Agent 的交接说明**。新会话（尤其是同一台机器上的另一个 Agent）开工前先读这一份 + [AGENTS.md](AGENTS.md)，再动手。
> 接手时先读「现在在哪」；**交回前请更新「现在在哪」与「下一步」两段**，并把改动全部 commit。这样谁都能无缝接上。

## 项目与仓库

- 十二阅读（12read）：本地优先的 Windows TXT 桌面阅读器。Electron 38 + React 19 + TypeScript + Zustand + zod，主进程直连 SQLite（better-sqlite3）+ iconv-lite 解码；构建 electron-vite，打包 electron-builder；测试 vitest（单测 / 契约）+ Playwright `_electron.launch`（e2e）。
- 仓库路径：`D:\Desktop\dsh工作区\十二阅读`。同一台机器上的另一个 Agent 直接用这个目录（并发注意事项见文末）。
- 包管理器 **pnpm**（有 `pnpm-lock.yaml`）。
- 目录分层：`src/main`（IPC / 服务 / SQLite / worker）、`src/preload`、`src/renderer`（React）、`src/shared`（通道名 + zod schema + 纯函数，如分章、搜索）。

## 怎么跑

```
pnpm install
pnpm dev            # 起 Electron 开发壳
pnpm verify         # 交付前必跑：eslint + node/web/e2e 三份 tsc + 单测 + 契约测试
pnpm test:e2e       # Playwright（会先 electron-vite build；9 个 spec，全量约 55s）
pnpm exec playwright test tests/e2e/chapters.spec.ts   # 只跑一个 spec
pnpm build          # 产出 out/
pnpm dist           # electron-vite build + electron-builder --dir（产出 release/）
```

判据：`pnpm verify` 与 e2e 全绿才算可交付（AGENTS.md 第 2 条）。当前基线是 **45 个测试文件 / 455 个用例**。

## 现在在哪（以 `git log` 为准）

- 分支 `main`，HEAD `bc62d00`「refactor(chapters): 删掉阅读器顶栏的「拆分」」，工作区干净。
- 版本号 `0.1.3`（package.json）。`origin/main` 停在 `271a84b`，**本地领先 29 个提交且未 push**；tag `v0.1.0`–`v0.1.3` 也都只在本地。
- **注意**：tag `v0.1.3`（附注 tag，指向 `88b00e0`）**不包含** `bc62d00` 这刀删除；`release/twelve-read-setup-0.1.3.exe` 也是旧产物（还带顶栏「拆分」按钮）。
- 0.1.3 的十项已全部交付并验证：书架版本号、正文字体与阅读宽度、左右翻动翻页、换编码重解码、手动改分章（改名 / 合并）、书签与划线（schema v2 迁移）、章节内 + 全书搜索、阅读统计、导出备份、大书性能专项。逐项 commit 见 [docs/MVP.md](docs/MVP.md) 的「已发布：0.1.3」表格。

## 下一步（按顺序）

1. **等用户拍板**：顶栏「拆分」的删除怎么发 ——
   - (A) 并进 0.1.3：重新 `pnpm dist` 打包，把 tag `v0.1.3` 重打到新提交（tag 没 push 过，改了外人看不见）；
   - (B) 留给下一版：tag 不动，CHANGELOG 新开「未发布」段记这次删除，安装包等下次发版再打。
   - **当前文档写的是 (A) 的口径**：[CHANGELOG.md](CHANGELOG.md) 的 0.1.3 段已去掉「拆分」，并在「本版范围」注明「发布前按用户反馈删掉了阅读器顶栏的「拆分」」。
2. 发布（用户点头才做）：`git push origin main` + `git push origin --tags`；GitHub Release 名写 `十二阅读 v0.1.3 内测版（Windows）`、勾 Pre-release（命名约定见 [CHANGELOG.md](CHANGELOG.md) 第 6-8 行）。
3. Backlog（PWA、分页模式、EPUB 等）见 [docs/MVP.md](docs/MVP.md) 第 10 节。

## 硬约束（来自 [AGENTS.md](AGENTS.md)）

1. 每次改动单独 commit，信息用 `type(scope): 中文说明`（如 `fix(reader): …`）。
2. 每次改动必须同步补 / 改测试，交付前 `pnpm verify` + `pnpm test:e2e` 全绿。
3. 文档跟着改：CHANGELOG（每个功能一条）、docs/MVP.md（进度表）、docs/TECH.md（IPC 通道表 + 变更记录）。

## 已知坑（都踩过）

- **Windows 上的临时 SQLite 文件库**：测试里用临时**文件**库（不是 `:memory:`）时，`afterEach` 直接 `rmSync` 会 EPERM，必须先关连接 —— 见 [annotations-repository.test.ts](tests/unit/annotations-repository.test.ts) 的 `openDbs` 写法。
- **产量物体积别用 node `fs.statSync` 量**：对 `release/win-unpacked/resources/app.asar` 会谎报「目录、size 0」；用 PowerShell `Get-Item` 看 `Length`。
- **冒烟测试**：把工作目录换到临时目录再启动 `release/win-unpacked/十二阅读.exe`，否则会顺着仓库根 `package.json` 跑成 dev 构建。
- **e2e 的两条隐含契约**：`pnpm test:e2e` 会先构建 `out/`；抽屉关着时 `#toc-list li` 必须是 0（惰性渲染）—— 改目录抽屉时别破坏。
- **大书**：性能靶子是 851 万字 / 41 节的书；超过 5 万字的章节跳转必须先一次铺到位再滚（store 的 `revealTo`），否则会「还原到一半卡住」。
- `release/`、`out/`、`coverage/`、`test-results/` 都在 `.gitignore` 里，别提交产物。

## 两个 Agent 同时干活（同一台机器）

- **同一目录**：git 的 index 会抢锁，别两边同时改。推荐给接手方开第二个工作区：`git worktree add ../12read-buddy main`（在里面单独分支干活，完事再合）；否则就明确约定「谁在做，另一个停手」。
- **不同目录**：不必 push 到 GitHub，直接把本地仓库当远端：`git remote add local "D:/Desktop/dsh工作区/十二阅读" && git fetch local && git merge local/main`。
- **交回时**：改动全部 commit，并更新本文件的「现在在哪」与「下一步」两段。
