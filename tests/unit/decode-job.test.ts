import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ImportStage } from '@shared/types'
import { ImportError } from '@main/services/import-error'
import { CHAPTERS_DIR, CONTENT_FILE, SOURCE_FILE, chapterFileName } from '@main/services/layout'
import { runDecodeJob, type DecodeJob, type DecodeJobResult } from '@main/workers/decode-job'
import {
  CHAPTERED_TEXT,
  SAMPLE_TEXT,
  bytesBinaryWithNul,
  bytesGbk,
  bytesUtf16leBom,
  bytesUtf8,
  bytesUtf8Bom
} from '../fixtures/texts'

/**
 * decode-job 是 worker 里的执行体，测试直接调用它就能完整覆盖
 * 解码 -> 切章 -> 落盘，无需真的起一个 worker 线程。
 */

interface ProgressEvent {
  stage: ImportStage
  ratio: number
  message?: string
}

let root = ''
let srcFile = ''
let destDir = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'decode-job-'))
  srcFile = join(root, 'source.txt')
  destDir = join(root, 'book')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function seedSource(bytes: Uint8Array): Promise<void> {
  await writeFile(srcFile, bytes)
}

function makeJob(contentMode: DecodeJob['contentMode']): DecodeJob {
  return { taskId: 'task-1', sourcePath: srcFile, destDir, contentMode }
}

async function run(
  contentMode: DecodeJob['contentMode']
): Promise<{ result: DecodeJobResult; events: ProgressEvent[] }> {
  const events: ProgressEvent[] = []
  const result = await runDecodeJob(makeJob(contentMode), (stage, ratio, message) => {
    events.push({ stage, ratio, message })
  })
  return { result, events }
}

function expectStages(events: ProgressEvent[], stages: ImportStage[]): void {
  for (const stage of stages) {
    expect(events.some((event) => event.stage === stage)).toBe(true)
  }
  for (const event of events) {
    expect(event.ratio).toBeGreaterThan(0)
    expect(event.ratio).toBeLessThanOrEqual(1)
  }
}

describe('runDecodeJob 单文件模式（single）', () => {
  it('UTF-8 正文写入 content.txt，source.bin 保存原始字节', async () => {
    await seedSource(bytesUtf8(SAMPLE_TEXT))

    const { result, events } = await run('single')

    expect(result.encoding).toBe('utf-8')
    expect(result.contentMode).toBe('single')
    expect(result.charCount).toBe(SAMPLE_TEXT.length)
    expect(result.chapters).toHaveLength(2)
    expect(result.usedFallback).toBe(false)
    expect(result.markerHits).toBe(2)
    expect(result.suspicious).toBe(false)
    expect(result.chapters[0]).toMatchObject({ title: '第一章 初见', startOffset: 0, kind: 'chapter' })

    expect(await readFile(join(destDir, CONTENT_FILE), 'utf8')).toBe(SAMPLE_TEXT)
    expect(new Uint8Array(await readFile(join(destDir, SOURCE_FILE)))).toEqual(bytesUtf8(SAMPLE_TEXT))
    expect(existsSync(join(destDir, CHAPTERS_DIR))).toBe(false)

    expectStages(events, ['reading', 'detecting', 'decoding', 'splitting', 'storing'])
    expect(events[0]).toEqual({ stage: 'reading', ratio: 0.02, message: undefined })
    expect(events.at(-1)?.stage).toBe('storing')
  })

  it('UTF-8 BOM 会被剥掉，正文里不残留 U+FEFF', async () => {
    await seedSource(bytesUtf8Bom(SAMPLE_TEXT))

    const { result } = await run('single')

    // 检测层把带 BOM 的 UTF-8 单独标注为 utf-8-bom，两者解码路径相同。
    expect(result.encoding).toBe('utf-8-bom')
    const text = await readFile(join(destDir, CONTENT_FILE), 'utf8')
    expect(text).toBe(SAMPLE_TEXT)
    expect(text.charCodeAt(0)).not.toBe(0xfeff)
  })

  it('GB18030 字节回落到 gb18030 解码', async () => {
    await seedSource(bytesGbk(SAMPLE_TEXT))

    const { result } = await run('single')

    expect(result.encoding).toBe('gb18030')
    expect(await readFile(join(destDir, CONTENT_FILE), 'utf8')).toBe(SAMPLE_TEXT)
  })

  it('UTF-16LE BOM 按 utf-16le 解码', async () => {
    await seedSource(bytesUtf16leBom(SAMPLE_TEXT))

    const { result } = await run('single')

    expect(result.encoding).toBe('utf-16le')
    expect(await readFile(join(destDir, CONTENT_FILE), 'utf8')).toBe(SAMPLE_TEXT)
  })

  it('CRLF 会归一成 LF，章节偏移与 content.txt 一致', async () => {
    await seedSource(bytesUtf8('前言部分。\r\n第一章 标题甲\r\n正文甲。\r\n第二章 标题乙\r\n正文乙。\r\n'))

    const { result } = await run('single')

    const text = await readFile(join(destDir, CONTENT_FILE), 'utf8')
    expect(text.includes('\r')).toBe(false)
    for (const chapter of result.chapters) {
      expect(text.slice(chapter.startOffset, chapter.startOffset + chapter.charLength).length).toBeGreaterThan(0)
    }
  })

  it('二进制文件抛出 code=binary 的 ImportError，且不建目录', async () => {
    await seedSource(bytesBinaryWithNul())

    const error = await runDecodeJob(makeJob('single'), () => undefined).then(
      () => null,
      (cause: unknown) => cause
    )

    expect(error).toBeInstanceOf(ImportError)
    expect((error as ImportError).code).toBe('binary')
    expect((error as ImportError).message).toBe('这不是一个纯文本文件')
    expect(existsSync(destDir)).toBe(false)
  })
})

describe('runDecodeJob 分片模式（sliced）', () => {
  it('按章节写入 chapters/NNNN.txt，且不生成 content.txt', async () => {
    await seedSource(bytesUtf8(SAMPLE_TEXT))

    const { result, events } = await run('sliced')

    expect(result.contentMode).toBe('sliced')
    expect(result.chapters).toHaveLength(2)
    expect(existsSync(join(destDir, CONTENT_FILE))).toBe(false)
    expect(existsSync(join(destDir, SOURCE_FILE))).toBe(true)
    expectStages(events, ['reading', 'detecting', 'decoding', 'splitting', 'storing'])

    for (const [index, chapter] of result.chapters.entries()) {
      const body = await readFile(join(destDir, CHAPTERS_DIR, chapterFileName(index)), 'utf8')
      expect(body).toBe(SAMPLE_TEXT.slice(chapter.startOffset, chapter.startOffset + chapter.charLength))
    }
  })

  it('章节数超过写盘并发度时，runPool 仍把每一片都写完', async () => {
    // 约 4.8 万字，兜底分段（目标 4000 字/片）必然多于 8 片，足以走满并发。
    const longText = Array.from(
      { length: 20 },
      (_, index) => '第' + (index + 1) + '段：' + '正文正文正文'.repeat(400)
    ).join('\n')
    await seedSource(bytesUtf8(longText))

    const { result } = await run('sliced')

    expect(result.usedFallback).toBe(true)
    expect(result.markerHits).toBe(0)
    expect(result.chapters.length).toBeGreaterThan(8)

    for (const [index, chapter] of result.chapters.entries()) {
      const body = await readFile(join(destDir, CHAPTERS_DIR, chapterFileName(index)), 'utf8')
      expect(body.length).toBe(chapter.charLength)
    }
  })

  it('已有标记的文本分片后仍保留开篇段', async () => {
    await seedSource(bytesUtf8(CHAPTERED_TEXT))

    const { result } = await run('sliced')

    expect(result.usedFallback).toBe(false)
    expect(result.chapters[0].kind).toBe('segment')
    expect(result.chapters[0].title).toBe('开篇')
    for (const [index, chapter] of result.chapters.entries()) {
      const body = await readFile(join(destDir, CHAPTERS_DIR, chapterFileName(index)), 'utf8')
      expect(body).toBe(CHAPTERED_TEXT.slice(chapter.startOffset, chapter.startOffset + chapter.charLength))
    }
  })
})
