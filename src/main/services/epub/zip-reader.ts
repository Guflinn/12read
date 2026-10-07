/**
 * 手写 lenient ZIP reader（0.2.0 第 1 项：读 EPUB 的容器）。
 *
 * 与 0.1.3 手写的 `zip-writer.ts` 对称成对，同样不引依赖。只覆盖「读本地电子书文件」
 * 的基本盘：EOCD + 中央目录定位、STORE 与 DEFLATE（Node 的 `zlib.inflateRawSync`）、
 * data descriptor、UTF-8 文件名位。**不装 Zip64、不碰加密包、不认其它压缩算法** ——
 * 这几种一律抛中文 `ZipError`，让上层翻成「这本书打不开」的提示，而不是硬解出乱码。
 *
 * 为什么以中央目录为准：ZIP 的**本地头**在流式写入时长度字段会是 0（真身写在数据后面的
 * data descriptor 里），而**中央目录**记的是最终值。所以尺寸与名字取中央目录，
 * 只有「数据从哪儿开始」用本地头自己的名字/扩展区长度算。
 */
import { inflateRawSync } from 'node:zlib'

/** 解析不了 / 不支持 / 数据损坏时抛这个，message 是给人看的中文。 */
export class ZipError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZipError'
  }
}

export interface ZipEntryInfo {
  /** 包内路径，'/' 分隔。 */
  name: string
  /** 0 = STORE，8 = DEFLATE；别的值到读数据时才报错。 */
  method: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
  /** 通用位 0：加密（EPUB 里就是 DRM）。 */
  encrypted: boolean
}

export interface ZipArchive {
  entries: ZipEntryInfo[]
  /** 条目名列表，顺序同中央目录。 */
  names: string[]
  has(name: string): boolean
  /** 按名字解压读一条；没有这条返回 null，损坏/加密则抛 ZipError。 */
  read(name: string): Buffer | null
  /** 按名字读文本（UTF-8，认 BOM；XML 声明里的 UTF-16 也认）。 */
  readText(name: string): string | null
}

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50
const FLAG_ENCRYPTED = 0x0001
const FLAG_UTF8 = 0x0800
const METHOD_STORE = 0
const METHOD_DEFLATE = 8
const SIZE_LOCAL = 30
const SIZE_CENTRAL = 46
const SIZE_EOCD = 22
/** EOCD 后面最多 64KB 的注释（规范上限）。 */
const MAX_COMMENT = 0xffff
/** 条目数上限：正常 EPUB 几百条，上万条必然是异常的包。 */
const MAX_ENTRIES = 10_000
/** 单条解压后体积上限：挡 zip bomb（正常书里的图片也就几 MB）。 */
const MAX_ENTRY_BYTES = 256 * 1024 * 1024

/** 从尾部往前找 EOCD（它一定在文件末尾，可能被注释挤在前面）。 */
function findEocd(bytes: Buffer): number {
  const earliest = Math.max(0, bytes.length - SIZE_EOCD - MAX_COMMENT)
  for (let at = bytes.length - SIZE_EOCD; at >= earliest; at -= 1) {
    if (bytes.readUInt32LE(at) === SIG_EOCD) return at
  }
  return -1
}

/**
 * 文件名解码：置了 UTF-8 位就按 UTF-8；没置的多半是 CP437 / latin1，
 * 这时先试 UTF-8，出现替换字符再退回 latin1（lenient：宁可名字略微走样也别读不出书）。
 */
function decodeName(raw: Buffer, flags: number): string {
  const utf8 = raw.toString('utf8')
  if ((flags & FLAG_UTF8) !== 0) return utf8
  return utf8.includes('\uFFFD') ? raw.toString('latin1') : utf8
}

export function openZip(bytes: Buffer): ZipArchive {
  if (bytes.length < SIZE_EOCD) throw new ZipError('文件太小，不像是一个 EPUB / ZIP 包')

  const eocd = findEocd(bytes)
  if (eocd < 0) throw new ZipError('这不是一个完整的 EPUB / ZIP 包（找不到结尾记录）')

  if (bytes.readUInt16LE(eocd + 4) !== 0 || bytes.readUInt16LE(eocd + 6) !== 0) {
    throw new ZipError('不支持分卷 ZIP')
  }
  const totalEntries = bytes.readUInt16LE(eocd + 10)
  const directorySize = bytes.readUInt32LE(eocd + 12)
  const directoryOffset = bytes.readUInt32LE(eocd + 16)
  if (
    bytes.readUInt16LE(eocd + 8) === 0xffff ||
    totalEntries === 0xffff ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff
  ) {
    throw new ZipError('不支持 Zip64 格式的 ZIP（超大文件或分卷）')
  }
  if (directoryOffset + directorySize > bytes.length) {
    throw new ZipError('ZIP 的中央目录越界，文件多半损坏了')
  }
  if (totalEntries > MAX_ENTRIES) {
    throw new ZipError('ZIP 里的条目过多（' + totalEntries + ' 条），已超出支持的规模')
  }

  const entries: ZipEntryInfo[] = []
  let cursor = directoryOffset
  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + SIZE_CENTRAL > bytes.length || bytes.readUInt32LE(cursor) !== SIG_CENTRAL) {
      throw new ZipError('ZIP 的中央目录损坏（第 ' + (index + 1) + ' 条读不出来）')
    }
    const flags = bytes.readUInt16LE(cursor + 8)
    const nameLength = bytes.readUInt16LE(cursor + 28)
    const nameStart = cursor + SIZE_CENTRAL
    if (nameStart + nameLength > bytes.length) {
      throw new ZipError('ZIP 里的文件名越界，文件损坏')
    }
    const name = decodeName(bytes.subarray(nameStart, nameStart + nameLength), flags)
    const uncompressedSize = bytes.readUInt32LE(cursor + 24)
    if (uncompressedSize > MAX_ENTRY_BYTES) {
      throw new ZipError('ZIP 里的「' + name + '」解压后过大，已拒绝解包')
    }
    entries.push({
      name,
      method: bytes.readUInt16LE(cursor + 10),
      compressedSize: bytes.readUInt32LE(cursor + 20),
      uncompressedSize,
      localHeaderOffset: bytes.readUInt32LE(cursor + 42),
      encrypted: (flags & FLAG_ENCRYPTED) !== 0
    })
    cursor = nameStart + nameLength + bytes.readUInt16LE(cursor + 30) + bytes.readUInt16LE(cursor + 32)
  }

  const byName = new Map<string, ZipEntryInfo>()
  for (const entry of entries) byName.set(entry.name, entry)

  return {
    entries,
    names: entries.map((entry) => entry.name),
    has: (name: string) => byName.has(name),
    read: (name: string) => readEntry(bytes, byName, name),
    readText: (name: string) => {
      const raw = readEntry(bytes, byName, name)
      return raw === null ? null : decodeText(raw)
    }
  }
}

function readEntry(
  bytes: Buffer,
  byName: Map<string, ZipEntryInfo>,
  name: string
): Buffer | null {
  const entry = byName.get(name)
  if (!entry) return null
  if (entry.encrypted) {
    throw new ZipError('ZIP 里的「' + name + '」是加密的（多半有版权保护），打不开')
  }

  const at = entry.localHeaderOffset
  if (at + SIZE_LOCAL > bytes.length || bytes.readUInt32LE(at) !== SIG_LOCAL) {
    throw new ZipError('ZIP 里「' + name + '」的数据头损坏')
  }
  // 数据起点用本地头自己的长度字段算：有些写入器会在中央目录与本地头里记不同的名字长度
  const dataStart = at + SIZE_LOCAL + bytes.readUInt16LE(at + 26) + bytes.readUInt16LE(at + 28)
  const dataEnd = dataStart + entry.compressedSize
  if (dataEnd > bytes.length) throw new ZipError('ZIP 里「' + name + '」的数据越界，文件损坏')
  const raw = bytes.subarray(dataStart, dataEnd)

  if (entry.method === METHOD_STORE) return Buffer.from(raw)
  if (entry.method !== METHOD_DEFLATE) {
    throw new ZipError('ZIP 里「' + name + '」用了不支持的压缩方式（' + entry.method + '）')
  }
  try {
    return inflateRawSync(raw)
  } catch {
    throw new ZipError('ZIP 里「' + name + '」的数据解不开（压缩数据损坏）')
  }
}

/** UTF-8（含 BOM）与 UTF-16（含 BOM）都认；EPUB 的 XML 就这两种。 */
function decodeText(raw: Buffer): string {
  if (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) return raw.subarray(2).toString('utf16le')
  if (raw.length >= 2 && raw[0] === 0xfe && raw[1] === 0xff) {
    const swapped = Buffer.from(raw.subarray(2))
    swapped.swap16()
    return swapped.toString('utf16le')
  }
  const withoutBom = raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf
    ? raw.subarray(3)
    : raw
  return withoutBom.toString('utf8')
}
