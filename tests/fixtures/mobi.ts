/**
 * 自造的 MOBI 夹具（0.3.0）。
 *
 * 为什么不用真书：`格式测试文件/` 里的《白夜行》有版权、也已 gitignore，绝不能进仓库。
 * 这里从零拼一个 **MOBI6 / KF7 + PalmDOC 压缩** 的文件（结构照真书实测的字段布局写），
 * 需要什么形态就传什么参数 —— 顺带把「压缩 / 解压」这条链路前后夹住：
 * 夹具写入时压、被测代码读时解，中间任何一步错了都会在断言里露出来。
 */

/** MOBI 头长度（真书实测 232，EXTH 紧随其后）。 */
const MOBI_HEADER_LENGTH = 232
/** PalmDOC 头的每块正文上限（真书实测 4096）。 */
const DEFAULT_RECORD_SIZE = 4096
const TEXT_ENCODING_UTF8 = 65001

export interface MobiFixtureOptions {
  title?: string
  author?: string
  /** 正文 HTML（KF7 形态）。默认是一本带翻页标记的两章小书。 */
  html?: string
  /** 封面图字节；给了才会写图片记录 + EXTH 201。 */
  cover?: Buffer | null
  /** 每块正文解压后的上限。调小可以在小夹具上覆盖「尾部附加数据」那条分支。 */
  recordSize?: number
  /** 每条正文记录尾部额外塞多少字节（模拟真书的附加数据）。 */
  trailingBytes?: number
  /** 0x01/0x02/0x08 … 的按位标志；配 trailingBytes 一起用。 */
  extraDataFlags?: number
  /** 1 = 不压缩，2 = PalmDOC。 */
  compression?: number
  /** 非 0 表示 DRM。 */
  encryption?: number
  /** MOBI 头里的 file version（8+ 是 KF8）。 */
  version?: number
  /** 传 false 就不写 EXTH（老文件）。 */
  withExth?: boolean
}

export const DEFAULT_MOBI_HTML =
  '<html><head></head><body>' +
  '<div><h1>测试小书</h1><p>这是封面页。</p></div>' +
  '<mbp:pagebreak/>' +
  '<div><h3>第一章 起风</h3><p>风从山口进来，吹动了窗上的旧报纸。</p></div>' +
  '<mbp:pagebreak/>' +
  '<div><h3>第二章 落雨</h3><p>雨落在瓦上，声音密得像有人在低声说话。</p></div>' +
  '</body></html>'

/** 一张最小的「JPEG」：只要魔数对得上，图片识别就会认它。 */
export const FAKE_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])

/**
 * 一张**真能解码**的 1×1 PNG。
 * e2e 里要断言「封面/插图真的显示出来了」（`naturalWidth > 0`），用上面那个假 JPEG 会挂。
 */
export const FAKE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
)

/** 这些检查在单测里反复用：正文里有没有混进控制字符（附加数据没切干净的典型症状）。 */
export function hasControlChars(text: string): boolean {
  for (const char of text) {
    const code = char.charCodeAt(0)
    // 制表 / 换行 / 回车是正文里正常的，其余控制字符说明二进制垃圾漏进来了
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return true
  }
  return false
}

/**
 * 只输出字面量的 PalmDOC 压缩。
 * 1..8 与 0x80..0xFF 必须转义（否则会被当成指令），其余字节原样写出。
 */
export function palmDocCompress(input: Buffer): Buffer {
  const out: number[] = []
  for (const byte of input) {
    if (byte === 0 || (byte >= 1 && byte <= 8) || byte >= 0x80) out.push(1, byte)
    else out.push(byte)
  }
  return Buffer.from(out)
}

/** 把 n 个字节编成 PalmDOC 字面量（模拟真书尾部那截「附加数据」）。 */
function literalRun(byteCount: number, fill: number): Buffer {
  const out: number[] = []
  let left = byteCount
  while (left > 0) {
    const take = Math.min(left, 8)
    out.push(take)
    for (let index = 0; index < take; index += 1) out.push(fill)
    left -= take
  }
  return Buffer.from(out)
}

export function createMobi(options: MobiFixtureOptions = {}): Buffer {
  const html = options.html ?? DEFAULT_MOBI_HTML
  const compression = options.compression ?? 2
  const recordSize = options.recordSize ?? DEFAULT_RECORD_SIZE
  const trailingBytes = options.trailingBytes ?? 0
  const extraDataFlags = options.extraDataFlags ?? (trailingBytes > 0 ? 0x02 : 0)
  const version = options.version ?? 6
  const withExth = options.withExth ?? true
  const cover = options.cover === undefined ? FAKE_JPEG : options.cover

  const text = Buffer.from(html, 'utf8')
  const chunks: Buffer[] = []
  for (let at = 0; at < text.length; at += recordSize) {
    chunks.push(text.subarray(at, Math.min(at + recordSize, text.length)))
  }

  const textRecords = chunks.map((chunk) => {
    const compressed = compression === 1 ? chunk : palmDocCompress(chunk)
    if (trailingBytes <= 0 || extraDataFlags === 0) return compressed
    return Buffer.concat([compressed, literalRun(trailingBytes, 0x58)])
  })

  const imageRecords = cover === null ? [] : [cover]
  const firstImageIndex = 1 + textRecords.length

  const exth = withExth
    ? buildExth([
        [100, Buffer.from(options.author ?? '测试作者', 'utf8')],
        [503, Buffer.from(options.title ?? '测试小书', 'utf8')],
        ...(cover === null ? [] : ([[201, uint32(0)]] as Array<[number, Buffer]>))
      ])
    : Buffer.alloc(0)

  const fullName = Buffer.from(options.title ?? '测试小书', 'utf8')
  // 记录 0 的布局：PalmDOC 头(16) + MOBI 头(232) + EXTH + 书名
  const record0Length = 16 + MOBI_HEADER_LENGTH + exth.length + fullName.length
  const record0 = Buffer.alloc(record0Length)

  record0.writeUInt16BE(compression, 0)
  record0.writeUInt32BE(text.length, 4)
  record0.writeUInt16BE(textRecords.length, 8)
  record0.writeUInt16BE(recordSize, 10)
  record0.writeUInt16BE(options.encryption ?? 0, 12)

  record0.write('MOBI', 16, 'latin1')
  record0.writeUInt32BE(MOBI_HEADER_LENGTH, 20)
  record0.writeUInt32BE(2, 24) // mobiType
  record0.writeUInt32BE(TEXT_ENCODING_UTF8, 28)
  record0.writeUInt32BE(0x1234abcd, 32) // unique id
  record0.writeUInt32BE(version, 36)
  record0.writeUInt32BE(firstImageIndex, 108)
  record0.writeUInt32BE(withExth ? 0x50 : 0, 128) // EXTH flags
  record0.writeUInt16BE(extraDataFlags, 242)
  const nameOffset = 16 + MOBI_HEADER_LENGTH + exth.length
  record0.writeUInt32BE(nameOffset, 84)
  record0.writeUInt32BE(fullName.length, 88)
  exth.copy(record0, 16 + MOBI_HEADER_LENGTH)
  fullName.copy(record0, nameOffset)

  return packPalmDb([record0, ...textRecords, ...imageRecords], 'TestBook')
}

function uint32(value: number): Buffer {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32BE(value, 0)
  return buffer
}

/** EXTH：`EXTH` + 总长 + 条数 + 每条「类型(4) 长度(4) 数据」。 */
function buildExth(entries: Array<[number, Buffer]>): Buffer {
  const body = Buffer.concat(
    entries.map(([type, data]) => {
      const item = Buffer.alloc(8 + data.length)
      item.writeUInt32BE(type, 0)
      item.writeUInt32BE(8 + data.length, 4)
      data.copy(item, 8)
      return item
    })
  )
  const head = Buffer.alloc(12)
  head.write('EXTH', 0, 'latin1')
  head.writeUInt32BE(12 + body.length, 4)
  head.writeUInt32BE(entries.length, 8)
  return Buffer.concat([head, body])
}

/** 78 字节文件头 + 每条 8 字节的索引表 + 记录数据。`name` 走 latin1（Palm 时代的老字段）。 */
function packPalmDb(records: Buffer[], name: string): Buffer {
  const tableEnd = 78 + records.length * 8
  const header = Buffer.alloc(tableEnd)
  header.write(name.slice(0, 31), 0, 'latin1')
  header.write('BOOK', 60, 'latin1')
  header.write('MOBI', 64, 'latin1')
  header.writeUInt16BE(records.length, 76)

  let offset = tableEnd
  records.forEach((record, index) => {
    header.writeUInt32BE(offset, 78 + index * 8)
    offset += record.length
  })

  return Buffer.concat([header, ...records])
}
