import { existsSync } from 'node:fs'
import * as iconv from 'iconv-lite'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ImportStage } from '@shared/types'
import { ImportError } from '@main/services/import-error'
import {
  CHAPTERS_DIR,
  CONTENT_FILE,
  IMAGES_DIR,
  IMAGES_MANIFEST,
  SOURCE_FILE,
  chapterFileName
} from '@main/services/layout'
import { runDecodeJob, type DecodeJob, type DecodeJobResult } from '@main/workers/decode-job'
import { createZip } from '@main/services/zip-writer'
import {
  CHAPTERED_TEXT,
  SAMPLE_TEXT,
  bytesBinaryWithNul,
  bytesGbk,
  bytesUtf16leBom,
  bytesUtf8,
  bytesUtf8Bom
} from '../fixtures/texts'
import { FAKE_JPEG, createMobi, hasControlChars } from '../fixtures/mobi'

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

function makeJob(contentMode: DecodeJob['contentMode'], encoding?: DecodeJob['encoding']): DecodeJob {
  return { taskId: 'task-1', sourcePath: srcFile, destDir, contentMode, encoding }
}

async function run(
  contentMode: DecodeJob['contentMode'],
  encoding?: DecodeJob['encoding']
): Promise<{ result: DecodeJobResult; events: ProgressEvent[] }> {
  const events: ProgressEvent[] = []
  const result = await runDecodeJob(makeJob(contentMode, encoding), (stage, ratio, message) => {
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

describe('runDecodeJob 指定编码（重新解码用）', () => {
  const BIG5_TEXT = '第一章 起点\n繁體中文測試，這是一本老書。\n'

  it('job.encoding 覆盖自动检测，big5 老书能解对', async () => {
    await seedSource(new Uint8Array(iconv.encode(BIG5_TEXT, 'big5')))

    // 自动检测永远不会给出 big5（GBK 与 BIG5 的字节区间重叠），解出来是乱码
    const guessed = await run('single')
    expect(guessed.result.encoding).not.toBe('big5')
    expect(await readFile(join(destDir, CONTENT_FILE), 'utf8')).not.toBe(BIG5_TEXT)

    const { result } = await run('single', 'big5')

    expect(result.encoding).toBe('big5')
    expect(result.suspicious).toBe(false)
    expect(await readFile(join(destDir, CONTENT_FILE), 'utf8')).toBe(BIG5_TEXT)
  })

  it('sliced 重解码会清掉多余的旧章文件', async () => {
    // 先在 chapters/ 里摆出「上次解得比这次多」的残留
    await seedSource(bytesUtf8(SAMPLE_TEXT))
    const stale = join(destDir, CHAPTERS_DIR)

    const first = await run('sliced')
    expect(first.result.chapters).toHaveLength(2)
    await writeFile(join(stale, chapterFileName(9)), '上一版留下的第九片', 'utf8')
    expect(await readdir(stale)).toContain(chapterFileName(9))

    const second = await run('sliced')

    expect(second.result.chapters).toHaveLength(2)
    expect(await readdir(stale)).toEqual([chapterFileName(0), chapterFileName(1)])
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

describe('runDecodeJob：EPUB（0.2.0 第 4/5 项）', () => {
  const EPUB = join(process.cwd(), 'tests/fixtures/mini.epub')

  it('整本模式：写 content.txt，结果带 format 与 OPF 里的书名作者', async () => {
    const job: DecodeJob = {
      taskId: 't1',
      sourcePath: EPUB,
      destDir,
      contentMode: 'single',
      format: 'epub'
    }
    const result = await runDecodeJob(job, () => undefined)

    expect(result.format).toBe('epub')
    expect(result.title).toBe('测试样书')
    expect(result.author).toBe('测试作者')
    expect(result.encoding).toBe('utf-8')
    expect(result.usedFallback).toBe(false)
    expect(result.chapters.map((chapter) => chapter.title)).toEqual([
      '第一章 起风',
      '第二章 落雨',
      '第二节 独行',
      '第三章 天晴'
    ])
    const text = await readFile(join(destDir, CONTENT_FILE), 'utf8')
    expect(text.length).toBe(result.charCount)
    expect(text).toContain('风从山口进来')
    // 原始字节留着，便于以后用新提取器重新提取（第 6 项）
    expect(existsSync(join(destDir, SOURCE_FILE))).toBe(true)
    // 整本模式不建 chapters 目录
    expect(existsSync(join(destDir, CHAPTERS_DIR))).toBe(false)
  })

  it('切片模式：按章写 chapters/NNNN.txt，并落图片与清单', async () => {
    const job: DecodeJob = {
      taskId: 't2',
      sourcePath: EPUB,
      destDir,
      contentMode: 'sliced',
      format: 'epub'
    }
    const result = await runDecodeJob(job, () => undefined)

    const files = (await readdir(join(destDir, CHAPTERS_DIR))).sort()
    expect(files).toEqual([chapterFileName(0), chapterFileName(1), chapterFileName(2), chapterFileName(3)])
    const first = await readFile(join(destDir, CHAPTERS_DIR, chapterFileName(0)), 'utf8')
    expect(first).toContain('第一章 起风')

    // 图片：@pics/pic1.png 落成 0001.png，清单里有「偏移 → 文件」
    const imageFiles = await readdir(join(destDir, IMAGES_DIR))
    expect(imageFiles).toEqual(['0001.png'])
    const manifest = JSON.parse(await readFile(join(destDir, IMAGES_MANIFEST), 'utf8')) as {
      images: Array<{ offset: number; file: string }>
    }
    expect(manifest.images).toHaveLength(1)
    expect(manifest.images[0]?.file).toBe('0001.png')
    expect(result.charCount).toBeGreaterThan(0)
  })

  it('正文里没有插图、只有封面时，封面文件照样要落盘（回归）', async () => {
    // 真书踩到过：writeImages 在「没有正文图」时提前返回，把封面一起跳过了
    const source = join(root, 'cover-only.epub')
    const entries = {
      'mimetype': 'application/epub+zip',
      'META-INF/container.xml':
        '<container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
      'OEBPS/content.opf': `<package><metadata><meta name="cover" content="c"/></metadata><manifest>
        <item id="c" href="Images/cover.jpg" media-type="image/jpeg"/>
        <item id="t" href="t.xhtml" media-type="application/xhtml+xml"/>
      </manifest><spine><itemref idref="t"/></spine></package>`,
      'OEBPS/t.xhtml': '<html><body><p>第一章</p><p>正文里没有任何插图。</p></body></html>',
      'OEBPS/Images/cover.jpg': Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
    }
    await writeFile(
      source,
      await createZip(
        Object.entries(entries).map(([path, data]) => ({
          path,
          data: typeof data === 'string' ? Buffer.from(data, 'utf8') : data
        }))
      )
    )
    await runDecodeJob(
      { taskId: 't-cover', sourcePath: source, destDir, contentMode: 'single', format: 'epub' },
      () => undefined
    )
    const files = await readdir(join(destDir, IMAGES_DIR))
    expect(files).toEqual(['cover.jpg'])
  })

  it('重新提取（redecode 语义）：编码参数对 EPUB 无效，但能再跑一次并覆盖旧产物', async () => {
    const first = await runDecodeJob(
      { taskId: 't3', sourcePath: EPUB, destDir, contentMode: 'single', format: 'epub' },
      () => undefined
    )
    // 传一个编码（UI 上 TXT 才会用）也不该改变 EPUB 的提取结果
    const again = await runDecodeJob(
      {
        taskId: 't4',
        sourcePath: EPUB,
        destDir,
        contentMode: 'single',
        format: 'epub',
        encoding: 'gb18030'
      },
      () => undefined
    )
    expect(again.charCount).toBe(first.charCount)
    expect(again.chapters).toEqual(first.chapters)
  })

  it('坏 EPUB 给中文错误，且什么都不落盘', async () => {
    const bad = join(root, 'broken.epub')
    await writeFile(bad, Buffer.alloc(4096, 0x41))
    await expect(
      runDecodeJob(
        { taskId: 't5', sourcePath: bad, destDir, contentMode: 'single', format: 'epub' },
        () => undefined
      )
    ).rejects.toThrow(/找不到结尾记录/)
    expect(existsSync(destDir)).toBe(false)
  })
})

describe('runDecodeJob：MOBI（0.3.0）', () => {
  const MOBI_HTML =
    '<html><body><div align="center"><img recindex="00001"/></div>' +
    '<mbp:pagebreak/><div><h3>第一章 起风</h3><p>风从山口进来，吹动了窗上的旧报纸。</p></div>' +
    '<mbp:pagebreak/><div><h3>第二章 落雨</h3><p>雨落在瓦上，声音密得像有人在低声说话。</p></div>' +
    '</body></html>'

  async function seedMobi(options: Parameters<typeof createMobi>[0] = {}): Promise<string> {
    const file = join(root, 'book.mobi')
    await writeFile(file, createMobi({ html: MOBI_HTML, ...options }))
    return file
  }

  it('整本模式：书名作者来自 EXTH，按翻页标记切章，封面与内联图都落盘', async () => {
    const file = await seedMobi()
    const result = await runDecodeJob(
      { taskId: 'm1', sourcePath: file, destDir, contentMode: 'single', format: 'mobi' },
      () => undefined
    )

    expect(result.format).toBe('mobi')
    expect(result.title).toBe('测试小书')
    expect(result.author).toBe('测试作者')
    expect(result.encoding).toBe('utf-8')
    expect(result.usedFallback).toBe(false)
    expect(result.chapters.map((chapter) => chapter.title)).toEqual(['封面', '第一章 起风', '第二章 落雨'])

    const text = await readFile(join(destDir, CONTENT_FILE), 'utf8')
    expect(text.length).toBe(result.charCount)
    expect(text).toContain('风从山口进来')
    // 原始字节留着，便于以后用新提取器重新提取
    expect(existsSync(join(destDir, SOURCE_FILE))).toBe(true)

    const imageFiles = (await readdir(join(destDir, IMAGES_DIR))).sort()
    expect(imageFiles).toEqual(['0001.jpg', 'cover.jpg'])
    const manifest = JSON.parse(await readFile(join(destDir, IMAGES_MANIFEST), 'utf8')) as {
      images: Array<{ offset: number; file: string }>
    }
    expect(manifest.images.map((image) => image.file)).toEqual(['0001.jpg'])
    expect(FAKE_JPEG.equals(await readFile(join(destDir, IMAGES_DIR, '0001.jpg')))).toBe(true)
  })

  it('切片模式：按章写 chapters/NNNN.txt', async () => {
    const file = await seedMobi()
    const result = await runDecodeJob(
      { taskId: 'm2', sourcePath: file, destDir, contentMode: 'sliced', format: 'mobi' },
      () => undefined
    )

    const files = (await readdir(join(destDir, CHAPTERS_DIR))).sort()
    expect(files).toEqual([chapterFileName(0), chapterFileName(1), chapterFileName(2)])
    const second = await readFile(join(destDir, CHAPTERS_DIR, chapterFileName(1)), 'utf8')
    expect(second).toContain('第一章 起风')
    expect(result.charCount).toBeGreaterThan(0)
  })

  it('每块带附加数据的书（真书形态）照样一个字不差', async () => {
    const file = await seedMobi({ recordSize: 64, trailingBytes: 40, extraDataFlags: 0x02 })
    const result = await runDecodeJob(
      { taskId: 'm3', sourcePath: file, destDir, contentMode: 'single', format: 'mobi' },
      () => undefined
    )
    const text = await readFile(join(destDir, CONTENT_FILE), 'utf8')
    expect(text).toContain('雨落在瓦上')
    expect(hasControlChars(text)).toBe(false)
    expect(result.chapters).toHaveLength(3)
  })

  it('坏 MOBI 给中文错误，且什么都不落盘', async () => {
    const bad = join(root, 'broken.mobi')
    await writeFile(bad, Buffer.alloc(4096, 0x41))
    await expect(
      runDecodeJob(
        { taskId: 'm4', sourcePath: bad, destDir, contentMode: 'single', format: 'mobi' },
        () => undefined
      )
    ).rejects.toThrow(/MOBI/)
    expect(existsSync(destDir)).toBe(false)
  })
})

/**
 * Markdown（0.4.0）：正文走 TXT 的解码路径，切章换成 ATX 标题，
 * 正文里**一个标记都不删**（偏移体系要求正文就是原始字符流）。
 */
describe('runDecodeJob 的 Markdown 分支（0.4.0）', () => {
  const MD = [
    '# 读书笔记',
    '',
    '## 第一章 起手',
    '正文里有 **粗体** 与 `代码`。',
    '',
    '- 一条清单',
    '- 另一条',
    '',
    '## 第二章 收束',
    '结尾。',
    ''
  ].join('\n')

  it('按标题切章，书名取第一个一级标题，正文原样落盘', async () => {
    await seedSource(bytesUtf8(MD))
    const result = await runDecodeJob(
      { taskId: 'md1', sourcePath: srcFile, destDir, contentMode: 'single', format: 'md' },
      () => undefined
    )

    expect(result.format).toBe('md')
    expect(result.title).toBe('读书笔记')
    expect(result.author).toBeNull()
    expect(result.chapters.map((c) => c.title)).toEqual(['开篇', '第一章 起手', '第二章 收束'])
    expect(result.chapters.map((c) => c.kind)).toEqual(['segment', 'chapter', 'chapter'])
    expect(result.charCount).toBe(MD.length)

    // 标记与文字都还在（渲染层负责把标记藏起来）
    const text = await readFile(join(destDir, CONTENT_FILE), 'utf8')
    expect(text).toBe(MD)
    expect(text).toContain('**粗体**')
    expect(text).toContain('## 第一章 起手')
  })

  it('手工指定编码时按指定编码解（与 TXT 同一条路径）', async () => {
    await seedSource(bytesGbk(MD))
    const result = await runDecodeJob(
      {
        taskId: 'md2',
        sourcePath: srcFile,
        destDir,
        contentMode: 'single',
        format: 'md',
        encoding: 'gb18030'
      },
      () => undefined
    )

    expect(result.encoding).toBe('gb18030')
    expect(result.title).toBe('读书笔记')
    expect(await readFile(join(destDir, CONTENT_FILE), 'utf8')).toBe(MD)
  })

  it('切片模式：按标题章节切到 chapters/NNNN.txt', async () => {
    await seedSource(bytesUtf8(MD))
    const result = await runDecodeJob(
      { taskId: 'md3', sourcePath: srcFile, destDir, contentMode: 'sliced', format: 'md' },
      () => undefined
    )

    const files = (await readdir(join(destDir, CHAPTERS_DIR))).sort()
    expect(files).toEqual([chapterFileName(0), chapterFileName(1), chapterFileName(2)])
    expect(await readFile(join(destDir, CHAPTERS_DIR, chapterFileName(1)), 'utf8')).toContain('## 第一章 起手')
    expect(result.chapters).toHaveLength(3)
  })

  it('没有标题结构时退回 TXT 规则，书名退回 null（用文件名）', async () => {
    const plain = '就是一段没有标题的笔记。'.repeat(30)
    await seedSource(bytesUtf8(plain))
    const result = await runDecodeJob(
      { taskId: 'md4', sourcePath: srcFile, destDir, contentMode: 'single', format: 'md' },
      () => undefined
    )

    expect(result.title).toBeNull()
    expect(result.usedFallback).toBe(true)
    expect(result.chapters[0].title).toBe('分段 1')
  })
})
