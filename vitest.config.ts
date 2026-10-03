import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@main': resolve(__dirname, 'src/main'),
      '@': resolve(__dirname, 'src/renderer/src')
    }
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/contract/**/*.test.ts'],
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: ['src/shared/**/*.ts', 'src/main/**/*.ts', 'src/renderer/src/core/**/*.ts', 'src/renderer/src/store/**/*.ts'],
      // 入口/窗口这类只能靠真实 Electron 跑起来的文件交给 e2e（tests/e2e）覆盖，
      // 单测里初始化 app / BrowserWindow 只会变成对 Electron 的 mock 表演。
      exclude: ['src/main/index.ts', 'src/main/window.ts', 'src/main/workers/decode.worker.ts'],
      // TECH 的验收门槛：行覆盖率 >= 90%。当前实测 行 98.79 / 语句 97.1 / 分支 91.49 / 函数 99.52，
      // 所以分支与其余三项都留了一点回旋空间，但任何一项跌破门槛都会让 verify 失败。
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 85 }
    }
  }
})
