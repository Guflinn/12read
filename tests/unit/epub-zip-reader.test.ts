import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { openZip, ZipError } from '@main/services/epub/zip-reader'
import { createZip } from '@main/services/zip-writer'

/**
 * 手写 ZIP reader（0.2.0 第 1 项）的单测。
 *
 * 正例直接用**自家 0.1.3 的 zip-writer** 造包（对称设计的额外好处：写入器写不出来的
 * 包，reader 也用不着认）；负例一律手工改坏字节 —— 真实坏包就是这么长出来的。
 */

const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50

/** 造一个包含「可压缩文本 / 不可压缩二进制 / 中文名 / 子目录」的样包。 */
async function sampleZip(): Promise<Buffer> {
  return createZip([
    { path: 'mimetype', data: Buffer.from('application/epub+zip', 'utf8') },
    { path: 'META-INF/container.xml', data: Buffer.from('<container/>'.repeat(200), 'utf8') },
    { path: 'OEBPS/正文.xhtml', data: Buffer.from('<html>第一章</html>', 'utf8') },
    {
      path: 'OEBPS/image.bin',
      // 真随机字节压不动 → zip-writer 会退回 STORE，正好覆盖两条解压路径
      // （注意：规律序列是能压的，别用 i*37%256 这种，deflate 一压就小）
      data: randomBytes(512)
    }
  ])
}

function findSignature(bytes: Buffer, signature: number): number {
  for (let at = 0; at + 4 <= bytes.length; at += 1) {
    if (bytes.readUInt32LE(at) === signature) return at
  }
  return -1
}

/** 第 index 条中央目录记录的起点。 */
function centralAt(bytes: Buffer, index: number): number {
  let at = findSignature(bytes, SIG_CENTRAL)
  for (let step = 0; step < index; step += 1) {
    const nameLength = bytes.readUInt16LE(at + 28)
    const extraLength = bytes.readUInt16LE(at + 30)
    const commentLength = bytes.readUInt16LE(at + 32)
    at += 46 + nameLength + extraLength + commentLength
  }
  return at
}

function eocdAt(bytes: Buffer): number {
  const at = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  expect(at).toBeGreaterThan(-1)
  expect(bytes.readUInt32LE(at)).toBe(SIG_EOCD)
  return at
}

describe('openZip 正例（自家 zip-writer 造的包）', () => {
  it('能把每条原样读回来，名字含中文与子目录', async () => {
    const zip = openZip(await sampleZip())

    expect(zip.names).toEqual([
      'mimetype',
      'META-INF/container.xml',
      'OEBPS/正文.xhtml',
      'OEBPS/image.bin'
    ])
    expect(zip.has('OEBPS/正文.xhtml')).toBe(true)
    expect(zip.has('OEBPS/不存在.xhtml')).toBe(false)

    expect(zip.readText('mimetype')).toBe('application/epub+zip')
    expect(zip.readText('OEBPS/正文.xhtml')).toBe('<html>第一章</html>')
    expect(zip.read('META-INF/container.xml')?.length).toBe('<container/>'.length * 200)
    expect(zip.read('OEBPS/不存在.xhtml')).toBeNull()
  })

  it('DEFLATE 与 STORE 两条路都走得到', async () => {
    const zip = openZip(await sampleZip())
    const method = (name: string): number =>
      zip.entries.find((entry) => entry.name === name)?.method ?? -1

    expect(method('META-INF/container.xml')).toBe(8) // 可压缩 → DEFLATE
    expect(method('OEBPS/image.bin')).toBe(0) // 压不动 → 退回 STORE
  })

  it('数据在本地头里尺寸为 0（data descriptor 写法）也能读：尺寸以中央目录为准', async () => {
    const bytes = await sampleZip()
    // 把第一条本地头的 crc / 压缩后 / 解压后 三个字段清零 —— 流式写入的包就是这样
    const local = findSignature(bytes, 0x04034b50)
    bytes.writeUInt32LE(0, local + 14)
    bytes.writeUInt32LE(0, local + 18)
    bytes.writeUInt32LE(0, local + 22)

    const zip = openZip(bytes)
    expect(zip.readText('mimetype')).toBe('application/epub+zip')
  })

  it('UTF-8 BOM 会被剥掉', async () => {
    const bytes = await createZip([
      { path: 'a.xml', data: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('<a/>')]) }
    ])
    expect(openZip(bytes).readText('a.xml')).toBe('<a/>')
  })

  it('UTF-16LE BOM 也认（XML 声明成 utf-16 的包）', async () => {
    const body = Buffer.from('<a>一</a>', 'utf16le')
    const bytes = await createZip([
      { path: 'b.xml', data: Buffer.concat([Buffer.from([0xff, 0xfe]), body]) }
    ])
    expect(openZip(bytes).readText('b.xml')).toBe('<a>一</a>')
  })

  it('空包（0 条目）不算错', async () => {
    const zip = openZip(await createZip([]))
    expect(zip.entries).toEqual([])
    expect(zip.read('any')).toBeNull()
  })
})

describe('openZip 负例（手工改坏 / 不支持）', () => {
  it('不是 ZIP：直接说找不到结尾记录', () => {
    const garbage = Buffer.alloc(64, 0x41)
    expect(() => openZip(garbage)).toThrow(ZipError)
    expect(() => openZip(garbage)).toThrow(/找不到结尾记录/)
  })

  it('文件被截断（少了尾巴）：同样报找不到结尾记录', async () => {
    const bytes = await sampleZip()
    expect(() => openZip(bytes.subarray(0, bytes.length - 10))).toThrow(/找不到结尾记录/)
  })

  it('太小：明确说文件太小', () => {
    expect(() => openZip(Buffer.alloc(8))).toThrow(/文件太小/)
  })

  it('ZIP 里的文件被加密（EPUB 的 DRM）：读的时候给版权保护的提示', async () => {
    const bytes = await sampleZip()
    const at = centralAt(bytes, 0)
    // 置通用位 0（加密）
    bytes.writeUInt16LE(bytes.readUInt16LE(at + 8) | 0x0001, at + 8)

    const zip = openZip(bytes)
    expect(zip.entries[0]?.encrypted).toBe(true)
    expect(() => zip.read('mimetype')).toThrow(/加密/)
  })

  it('Zip64 标记：明确说不支持，而不是硬解', async () => {
    const bytes = await sampleZip()
    const eocd = eocdAt(bytes)
    bytes.writeUInt32LE(0xffffffff, eocd + 16) // 中央目录偏移写成 Zip64 占位
    expect(() => openZip(bytes)).toThrow(/Zip64/)
  })

  it('分卷标记：明确说不支持', async () => {
    const bytes = await sampleZip()
    const eocd = eocdAt(bytes)
    bytes.writeUInt16LE(1, eocd + 4)
    expect(() => openZip(bytes)).toThrow(/分卷/)
  })

  it('中央目录条目数比实际多：报中央目录损坏', async () => {
    const bytes = await sampleZip()
    const eocd = eocdAt(bytes)
    bytes.writeUInt16LE(bytes.readUInt16LE(eocd + 10) + 3, eocd + 10)
    expect(() => openZip(bytes)).toThrow(/中央目录损坏/)
  })

  it('条目数超上限：在解包前就拒绝', async () => {
    const bytes = await sampleZip()
    const eocd = eocdAt(bytes)
    bytes.writeUInt16LE(20000, eocd + 10)
    expect(() => openZip(bytes)).toThrow(/条目过多/)
  })

  it('中央目录偏移越界：报越界', async () => {
    const bytes = await sampleZip()
    const eocd = eocdAt(bytes)
    bytes.writeUInt32LE(bytes.length + 100, eocd + 16)
    expect(() => openZip(bytes)).toThrow(/越界/)
  })

  it('单条解压后体积异常大（zip bomb）：拒绝解包', async () => {
    const bytes = await sampleZip()
    const at = centralAt(bytes, 1)
    bytes.writeUInt32LE(300 * 1024 * 1024, at + 24)
    expect(() => openZip(bytes)).toThrow(/过大/)
  })

  it('用了不支持的压缩方式：报清楚是哪一条与哪种方式', async () => {
    const bytes = await sampleZip()
    const at = centralAt(bytes, 1)
    bytes.writeUInt16LE(12, at + 10) // bzip2
    const zip = openZip(bytes)
    expect(() => zip.read('META-INF/container.xml')).toThrow(/不支持的压缩方式（12）/)
  })

  it('压缩数据损坏（长度对不上）：报解不开', async () => {
    const bytes = await sampleZip()
    const at = centralAt(bytes, 1)
    bytes.writeUInt32LE(0, at + 20) // 压缩后长度写成 0 → DEFLATE 流是空的
    const zip = openZip(bytes)
    expect(() => zip.read('META-INF/container.xml')).toThrow(/解不开/)
  })

  it('本地头签名坏掉：报数据头损坏', async () => {
    const bytes = await sampleZip()
    const local = findSignature(bytes, 0x04034b50)
    bytes.writeUInt32LE(0x11111111, local)
    const zip = openZip(bytes)
    expect(() => zip.read('mimetype')).toThrow(/数据头损坏/)
  })
})
