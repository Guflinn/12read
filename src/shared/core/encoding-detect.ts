import type { Encoding } from '../types'

/**
 * 编码检测（TECH.md 6.1）。纯字节运算，不依赖 iconv-lite，
 * 以便 main worker 与单测共用。真正的解码由 main 侧完成。
 */

/** 二进制嗅探只看开头这么多字节。 */
export const BINARY_SAMPLE_BYTES = 8192
/** 不可打印字节占比超过这个值就当二进制。 */
export const NON_PRINTABLE_RATIO_LIMIT = 0.3
/** 严格 UTF-8 校验只看开头这么多字节。 */
export const UTF8_SAMPLE_BYTES = 256 * 1024
/** 解码结果体检只看前这么多字符。 */
export const HEALTH_SAMPLE_CHARS = 100_000
/** U+FFFD 占比超过这个值说明编码猜错了。 */
export const REPLACEMENT_RATIO_LIMIT = 0.002
/** 私用区字符占比超过这个值说明编码猜错了。 */
export const PRIVATE_USE_RATIO_LIMIT = 0.02

export type DetectionReason = 'bom' | 'utf-8' | 'fallback-gb18030' | 'binary' | 'empty'

export interface EncodingDetection {
  encoding: Encoding
  /** 需要跳过的 BOM 字节数。 */
  bomLength: number
  binary: boolean
  reason: DetectionReason
}

export function detectBom(bytes: Uint8Array): { encoding: Encoding; length: number } | null {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { encoding: 'utf-8-bom', length: 3 }
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { encoding: 'utf-16le', length: 2 }
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { encoding: 'utf-16be', length: 2 }
  }
  return null
}

/** tab / LF / CR / 可打印 ASCII / 所有 >=0x80 的字节都算「文本」。 */
function isTextByte(b: number): boolean {
  if (b === 0x09 || b === 0x0a || b === 0x0d) return true
  if (b >= 0x20 && b <= 0x7e) return true
  return b >= 0x80
}

export function looksBinary(bytes: Uint8Array, sampleSize = BINARY_SAMPLE_BYTES): boolean {
  const n = Math.min(bytes.length, sampleSize)
  if (n === 0) return false
  let bad = 0
  for (let i = 0; i < n; i += 1) {
    const b = bytes[i]
    if (b === 0) return true
    if (!isTextByte(b)) bad += 1
  }
  return bad / n > NON_PRINTABLE_RATIO_LIMIT
}

/**
 * 用 fatal TextDecoder 做严格 UTF-8 校验。
 * 取样可能在多字节字符中间截断，所以失败时最多回退 3 个字节再试。
 */
export function isValidUtf8(bytes: Uint8Array, limit = UTF8_SAMPLE_BYTES): boolean {
  let end = Math.min(bytes.length, limit)
  for (let attempt = 0; attempt < 4 && end > 0; attempt += 1) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, end))
      return true
    } catch {
      end -= 1
    }
  }
  return false
}

/**
 * 检测顺序：BOM -> 二进制 -> 严格 UTF-8 -> gb18030。
 * BOM 必须先判：UTF-16 文件天然含 0x00，先做二进制嗅探会误杀。
 */
export function detectEncoding(bytes: Uint8Array): EncodingDetection {
  const bom = detectBom(bytes)
  if (bom) {
    return { encoding: bom.encoding, bomLength: bom.length, binary: false, reason: 'bom' }
  }
  if (bytes.length === 0) {
    return { encoding: 'utf-8', bomLength: 0, binary: false, reason: 'empty' }
  }
  if (looksBinary(bytes)) {
    return { encoding: 'unknown', bomLength: 0, binary: true, reason: 'binary' }
  }
  if (isValidUtf8(bytes)) {
    return { encoding: 'utf-8', bomLength: 0, binary: false, reason: 'utf-8' }
  }
  return { encoding: 'gb18030', bomLength: 0, binary: false, reason: 'fallback-gb18030' }
}

export interface DecodedTextHealth {
  suspicious: boolean
  replacementRatio: number
  privateUseRatio: number
  sampledChars: number
}

function isPrivateUse(cp: number): boolean {
  return (
    (cp >= 0xe000 && cp <= 0xf8ff) ||
    (cp >= 0xf0000 && cp <= 0xffffd) ||
    (cp >= 0x100000 && cp <= 0x10fffd)
  )
}

/** 解码后体检：U+FFFD 与私用区比例异常就只加警告，不阻塞导入。 */
export function assessDecodedText(text: string, sampleChars = HEALTH_SAMPLE_CHARS): DecodedTextHealth {
  const sample = text.length > sampleChars ? text.slice(0, sampleChars) : text
  let total = 0
  let replacement = 0
  let privateUse = 0
  for (const ch of sample) {
    total += 1
    const cp = ch.codePointAt(0) ?? 0
    if (cp === 0xfffd) replacement += 1
    else if (isPrivateUse(cp)) privateUse += 1
  }
  const replacementRatio = total === 0 ? 0 : replacement / total
  const privateUseRatio = total === 0 ? 0 : privateUse / total
  return {
    suspicious: replacementRatio > REPLACEMENT_RATIO_LIMIT || privateUseRatio > PRIVATE_USE_RATIO_LIMIT,
    replacementRatio,
    privateUseRatio,
    sampledChars: total
  }
}
