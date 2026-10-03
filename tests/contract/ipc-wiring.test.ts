import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CH } from '@shared/channels'

/**
 * 静态接线契约：通道清单、main 侧注册、preload 白名单三者必须一致。
 * 漏接一个通道是这类应用最容易犯的错，这里用文本级断言兜住。
 */
const root = process.cwd()
const mainSource = readFileSync(join(root, 'src/main/ipc.ts'), 'utf8')
const preloadSource = readFileSync(join(root, 'src/preload/index.ts'), 'utf8')

const requestChannels = Object.entries(CH).filter(([, name]) => name !== CH.importProgress)

describe('IPC 接线', () => {
  it('除 import:progress 外，每个通道都在 main 侧注册', () => {
    for (const [key, name] of requestChannels) {
      expect(mainSource.includes('CH.' + key), 'main 未注册 ' + name).toBe(true)
    }
  })

  it('每个通道都在 preload 白名单里', () => {
    for (const [key, name] of requestChannels) {
      expect(preloadSource.includes('CH.' + key), 'preload 未暴露 ' + name).toBe(true)
    }
  })

  it('import:progress 只由 main 推送、preload 订阅', () => {
    expect(preloadSource.includes('CH.importProgress')).toBe(true)
    expect(mainSource.includes('CH.importProgress')).toBe(false)
  })
})
