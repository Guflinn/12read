import * as iconv from 'iconv-lite'
import { assessDecodedText, detectEncoding } from '@shared/core/encoding-detect'
import type { Encoding } from '@shared/types'
import { ImportError } from './import-error'

/**
 * 解码流水线（TECH.md 6）：BOM -> 严格 UTF-8 -> GB18030 兜底 -> 健康检查。
 * 全程只依赖纯检测函数 + iconv-lite，因此可以在单测里直接喂字节。
 */
export interface DecodeOutcome {
  text: string
  encoding: Encoding
  suspicious: boolean
}

/** CRLF / 孤立 CR 一律归一成 LF；这是偏移量的唯一口径，必须在切章之前完成。 */
export function normalizeNewlines(text: string): string {
  return text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text
}

export function decodeBody(encoding: Encoding, body: Uint8Array): string {
  const buffer = Buffer.from(body.buffer, body.byteOffset, body.byteLength)
  switch (encoding) {
    case 'utf-16le':
      return iconv.decode(buffer, 'utf-16le')
    case 'utf-16be':
      return iconv.decode(buffer, 'utf-16be')
    case 'gb18030':
      return iconv.decode(buffer, 'gb18030')
    default:
      return new TextDecoder('utf-8').decode(body)
  }
}

export function decodeBytes(bytes: Uint8Array): DecodeOutcome {
  const detection = detectEncoding(bytes)
  if (detection.binary) throw new ImportError('binary', '这不是一个纯文本文件')

  const body = detection.bomLength > 0 ? bytes.subarray(detection.bomLength) : bytes
  let text: string
  try {
    text = decodeBody(detection.encoding, body)
  } catch (cause) {
    throw new ImportError('decode-failed', '无法解码该文本文件', cause)
  }

  const normalized = normalizeNewlines(text)
  const health = assessDecodedText(normalized)
  return {
    text: normalized,
    encoding: health.suspicious ? 'unknown' : detection.encoding,
    suspicious: health.suspicious
  }
}
