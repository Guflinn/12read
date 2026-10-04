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
    case 'big5':
      // big5 只在用户手工指定时出现（自动检测永远不给它），繁体老书用得上
      return iconv.decode(buffer, 'big5')
    default:
      return new TextDecoder('utf-8').decode(body)
  }
}

/**
 * 用户手工指定编码的解码路径：不做检测，直接按这个编码解，再跑一次健康检查。
 * 编码不对时结果同样可疑，所以 suspicious 照样会给出来（只警告，不拦）。
 */
export function decodeBytesWith(bytes: Uint8Array, encoding: Encoding): DecodeOutcome {
  let text: string
  try {
    text = decodeBody(encoding, bytes)
  } catch (cause) {
    throw new ImportError('decode-failed', '无法用这个编码解码该文件', cause)
  }
  // iconv 解出来的 BOM 会变成 U+FEFF 开头，手工解码时自己摘掉
  const normalized = normalizeNewlines(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
  return { text: normalized, encoding, suspicious: assessDecodedText(normalized).suspicious }
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
