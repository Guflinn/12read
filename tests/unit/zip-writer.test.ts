import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { createZip, crc32 } from '@main/services/zip-writer'

interface ParsedEntry {
  path: string
  flags: number
  method: number
  crc: number
  compressedSize: number
  size: number
  data: Buffer
}

/** 独立写一遍解析：不信任被测代码自己的读数方式。 */
function parseZip(zip: Buffer): ParsedEntry[] {
  const eocd = zip.length - 22
  expect(zip.readUInt32LE(eocd)).toBe(0x06054b50)
  const count = zip.readUInt16LE(eocd + 10)
  const directoryOffset = zip.readUInt32LE(eocd + 16)
  const entries: ParsedEntry[] = []
  let cursor = directoryOffset

  for (let index = 0; index < count; index += 1) {
    expect(zip.readUInt32LE(cursor)).toBe(0x02014b50)
    const flags = zip.readUInt16LE(cursor + 8)
    const method = zip.readUInt16LE(cursor + 10)
    const crc = zip.readUInt32LE(cursor + 16)
    const compressedSize = zip.readUInt32LE(cursor + 20)
    const size = zip.readUInt32LE(cursor + 24)
    const nameLength = zip.readUInt16LE(cursor + 28)
    const extraLength = zip.readUInt16LE(cursor + 30)
    const commentLength = zip.readUInt16LE(cursor + 32)
    const localOffset = zip.readUInt32LE(cursor + 42)
    const path = zip.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')

    expect(zip.readUInt32LE(localOffset)).toBe(0x04034b50)
    const localNameLength = zip.readUInt16LE(localOffset + 26)
    const localExtraLength = zip.readUInt16LE(localOffset + 28)
    const start = localOffset + 30 + localNameLength + localExtraLength
    const raw = zip.subarray(start, start + compressedSize)
    const data = method === 8 ? inflateRawSync(raw) : Buffer.from(raw)

    entries.push({ path, flags, method, crc, compressedSize, size, data })
    cursor += 46 + nameLength + extraLength + commentLength
  }

  return entries
}

const tempDirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), '12read-zip-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('zip-writer: CRC32', () => {
  it('已知向量对得上', () => {
    expect(crc32(Buffer.from(''))).toBe(0)
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926)
    expect(crc32(Buffer.from('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339)
  })
})

describe('zip-writer: 打包结构', () => {
  it('空包只有一条 EOCD，条目数为 0', async () => {
    const zip = await createZip([])
    expect(zip.length).toBe(22)
    expect(zip.readUInt32LE(0)).toBe(0x06054b50)
    expect(zip.readUInt16LE(10)).toBe(0)
    expect(parseZip(zip)).toEqual([])
  })

  it('文本条目用 deflate，读回来与原内容一致', async () => {
    const text = '山川湖海风雨星辰晨昏四季'.repeat(200)
    const zip = await createZip([{ path: 'books/a/content.txt', data: Buffer.from(text, 'utf8') }])
    const [entry] = parseZip(zip)

    expect(entry?.path).toBe('books/a/content.txt')
    expect(entry?.method).toBe(8)
    expect(entry?.size).toBe(Buffer.byteLength(text, 'utf8'))
    expect(entry?.data.toString('utf8')).toBe(text)
    expect(entry?.crc).toBe(crc32(Buffer.from(text, 'utf8')))
    expect(entry?.compressedSize).toBeLessThan(entry?.size ?? 0)
  })

  it('压不小就退回 STORE，字节仍然一个不差', async () => {
    // 真随机字节压不动，deflate 只会更长
    const binary = randomBytes(4096)
    const zip = await createZip([{ path: 'source.bin', data: binary }])
    const [entry] = parseZip(zip)

    expect(entry?.method).toBe(0)
    expect(entry?.size).toBe(binary.length)
    expect(entry?.compressedSize).toBe(binary.length)
    expect(entry?.data.equals(binary)).toBe(true)
  })

  it('空文件也能打包（STORE，长度 0）', async () => {
    const zip = await createZip([{ path: 'empty.txt', data: Buffer.alloc(0) }])
    const [entry] = parseZip(zip)
    expect(entry?.method).toBe(0)
    expect(entry?.size).toBe(0)
    expect(entry?.data.length).toBe(0)
  })

  it('多条条目按传入顺序进目录，中文名字置 UTF-8 位', async () => {
    const zip = await createZip(
      [
        { path: '12read-backup.json', data: Buffer.from('{"a":1}', 'utf8') },
        { path: 'books/x/中文.txt', data: Buffer.from('正文', 'utf8') }
      ],
      new Date(2026, 9, 5, 8, 30, 0)
    )
    const entries = parseZip(zip)

    expect(entries.map((entry) => entry.path)).toEqual(['12read-backup.json', 'books/x/中文.txt'])
    expect(entries[1]?.flags & 0x0800).toBe(0x0800)
    expect(entries[1]?.data.toString('utf8')).toBe('正文')
  })

  it('系统 tar 能解出同样的内容（独立校验，Explorer 同款）', async () => {
    const probe = spawnSync('tar', ['--version'], { encoding: 'utf8' })
    if (probe.error || probe.status !== 0) {
      console.warn('跳过：本机没有可用的 tar')
      return
    }

    const text = '山川湖海风雨星辰晨昏四季'.repeat(50)
    const zip = await createZip([
      { path: '12read-backup.json', data: Buffer.from('{"schemaVersion":2}', 'utf8') },
      { path: 'books/a/source.bin', data: Buffer.from(text, 'utf8') }
    ])
    const dir = tempDir()
    const archive = join(dir, 'backup.zip')
    writeFileSync(archive, zip)

    const result = spawnSync('tar', ['-xf', archive, '-C', dir], { encoding: 'utf8' })
    expect(result.status, result.stderr).toBe(0)
    expect(readFileSync(join(dir, '12read-backup.json'), 'utf8')).toBe('{"schemaVersion":2}')
    expect(readFileSync(join(dir, 'books', 'a', 'source.bin'), 'utf8')).toBe(text)
  })
})
