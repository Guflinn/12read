/**
 * PalmDOC 头 + MOBI 头 + EXTH（0.3.0）。
 *
 * 三块都挤在记录 0 里，前面还常常垫着一段「整本书的原始 HTML 头」——真实文件实测，EXTH
 * 的位置靠 headerLength 算，**不能按固定偏移去读**（每个工具写出来的头长度都不一样）。
 *
 *   [0..15]   PalmDOC 头：压缩方式 / 正文长度 / 记录数 / 每块大小 / 加密标志
 *   [16..]    MOBI 头：version / 编码 / firstImageIndex / EXTH 标志 / 尾部附加数据标志
 *   [16+len]  EXTH：一串「类型 + 长度 + 数据」，书名作者封面都在这里
 */
import { MobiError } from './errors'

/** PalmDOC 头的压缩方式。17480 = 0x4448，Huff/CDic。 */
export const COMPRESSION_NONE = 1
export const COMPRESSION_PALMDOC = 2
export const COMPRESSION_HUFF = 17480

export interface PalmDocHeader {
  compression: number
  /** 全书正文的字节数（**不含**每块尾部的附加数据）。 */
  textLength: number
  /** 正文记录条数（记录 1 起算）。 */
  recordCount: number
  /** 每块正文解压后的上限，常见 4096。 */
  recordSize: number
  /** 0 = 没加密；非 0 是 DRM。 */
  encryption: number
}

export interface MobiHeader {
  /** MOBI 头的长度，EXTH 从 `16 + headerLength` 开始。 */
  headerLength: number
  /** 2 = 普通电子书；248 = KF8。 */
  mobiType: number
  /** 1252 = cp1252，65001 = UTF-8。 */
  textEncoding: number
  /** 6 = MOBI6（KF7），8 = KF8。 */
  version: number
  /** 图片记录的起始下标；正文里的 `recindex` 相对它计算。 */
  firstImageIndex: number
  /** 非 0 表示记录 0 后面紧跟 EXTH。 */
  exthFlags: number
  /** 每条正文记录尾部的附加数据标志（多字节补字 / 索引项）。 */
  extraDataFlags: number
  /** 头里写的书名（full name），拿不到就给 null。 */
  fullName: string | null
}

export function readPalmDocHeader(record0: Buffer): PalmDocHeader {
  if (record0.length < 16) throw new MobiError('这个文件的 PalmDOC 头不完整')
  return {
    compression: record0.readUInt16BE(0),
    textLength: record0.readUInt32BE(4),
    recordCount: record0.readUInt16BE(8),
    recordSize: record0.readUInt16BE(10),
    encryption: record0.readUInt16BE(12)
  }
}

export function readMobiHeader(record0: Buffer): MobiHeader {
  if (record0.length < 24 || record0.subarray(16, 20).toString('latin1') !== 'MOBI') {
    throw new MobiError('这个文件里没有 MOBI 头，可能不是 MOBI 电子书')
  }
  const headerLength = record0.readUInt32BE(20)
  if (16 + headerLength > record0.length) {
    throw new MobiError('这个 MOBI 的头长度不合法，文件可能损坏了')
  }
  const encoding = record0.readUInt32BE(28)
  const fullNameOffset = record0.readUInt32BE(84)
  const fullNameLength = record0.readUInt32BE(88)

  return {
    headerLength,
    mobiType: record0.readUInt32BE(24),
    textEncoding: encoding,
    version: record0.readUInt32BE(36),
    firstImageIndex: record0.readUInt32BE(108),
    exthFlags: record0.readUInt32BE(128),
    // 尾部附加数据标志在 MOBI 头里的相对偏移 226（记录 0 的绝对偏移 242）
    extraDataFlags: 16 + 226 + 2 <= record0.length ? record0.readUInt16BE(242) : 0,
    fullName:
      fullNameOffset > 0 && fullNameLength > 0 && fullNameOffset + fullNameLength <= record0.length
        ? decodeBytes(record0.subarray(fullNameOffset, fullNameOffset + fullNameLength), encoding).trim()
        : null
  }
}

/** EXTH 记录类型。只列我们真会用的，其余原样留着不解读。 */
export const EXTH_AUTHOR = 100
export const EXTH_TITLE = 503
/** 封面在图片记录里的下标（相对 firstImageIndex）。 */
export const EXTH_COVER_OFFSET = 201

export type ExthMap = Map<number, Buffer[]>

/** 解析 EXTH；没有 EXTH（老文件、或 exthFlags 为 0）时给空表而不是报错。 */
export function parseExth(record0: Buffer, header: MobiHeader): ExthMap {
  const map: ExthMap = new Map()
  const start = 16 + header.headerLength
  if (header.exthFlags === 0 || start + 12 > record0.length) return map
  if (record0.subarray(start, start + 4).toString('latin1') !== 'EXTH') return map

  const count = record0.readUInt32BE(start + 8)
  let at = start + 12
  for (let index = 0; index < count && at + 8 <= record0.length; index += 1) {
    const type = record0.readUInt32BE(at)
    const length = record0.readUInt32BE(at + 4)
    // length 连 8 字节的头一起算；坏长度直接停，别越界读出垃圾
    if (length < 8 || at + length > record0.length) break
    const data = record0.subarray(at + 8, at + length)
    const list = map.get(type)
    if (list) list.push(data)
    else map.set(type, [data])
    at += length
  }
  return map
}

/** 取 EXTH 里第一条文本记录（按给定编码解），没有就给 null。 */
export function exthText(map: ExthMap, type: number, encoding: number): string | null {
  const data = map.get(type)?.[0]
  if (data === undefined) return null
  const text = decodeBytes(data, encoding).replace(/\0+$/, '').trim()
  return text === '' ? null : text
}

/** 取 EXTH 里第一条 4 字节整数记录，没有就给 null。 */
export function exthNumber(map: ExthMap, type: number): number | null {
  const data = map.get(type)?.[0]
  if (data === undefined || data.length < 4) return null
  return data.readUInt32BE(0)
}

/** MOBI 的 textEncoding 码 → 解码。65001 是 UTF-8，其余（常见 1252）按单字节读。 */
export function decodeBytes(bytes: Buffer, textEncoding: number): string {
  if (textEncoding === 65001) return bytes.toString('utf8')
  return bytes.toString('latin1')
}
