import { describe, expect, it } from 'vitest'
import { ImportError } from '@main/services/import-error'
import { decodeBytes, normalizeNewlines } from '@main/services/decode'
import {
  CRLF_TEXT,
  SAMPLE_TEXT,
  bytesBinaryControls,
  bytesBinaryWithNul,
  bytesGbk,
  bytesUtf8,
  bytesUtf8Bom,
  bytesUtf16beBom,
  bytesUtf16leBom
} from '../fixtures/texts'

const REPLACEMENT = String.fromCharCode(0xfffd)

describe('解码流水线', () => {
  it('无 BOM 的 UTF-8', () => {
    const out = decodeBytes(bytesUtf8(SAMPLE_TEXT))
    expect(out.encoding).toBe('utf-8')
    expect(out.text).toBe(SAMPLE_TEXT)
    expect(out.suspicious).toBe(false)
  })

  it('UTF-8 BOM 被剥掉但编码标记保留', () => {
    const out = decodeBytes(bytesUtf8Bom(SAMPLE_TEXT))
    expect(out.encoding).toBe('utf-8-bom')
    expect(out.text).toBe(SAMPLE_TEXT)
  })

  it('UTF-16LE / UTF-16BE BOM', () => {
    expect(decodeBytes(bytesUtf16leBom(SAMPLE_TEXT)).encoding).toBe('utf-16le')
    expect(decodeBytes(bytesUtf16leBom(SAMPLE_TEXT)).text).toBe(SAMPLE_TEXT)
    expect(decodeBytes(bytesUtf16beBom(SAMPLE_TEXT)).encoding).toBe('utf-16be')
    expect(decodeBytes(bytesUtf16beBom(SAMPLE_TEXT)).text).toBe(SAMPLE_TEXT)
  })

  it('GBK 中文不会乱码', () => {
    const out = decodeBytes(bytesGbk(SAMPLE_TEXT))
    expect(out.encoding).toBe('gb18030')
    expect(out.text).toBe(SAMPLE_TEXT)
  })

  it('二进制文件直接拒绝', () => {
    expect(() => decodeBytes(bytesBinaryWithNul())).toThrowError('这不是一个纯文本文件')
    let error: unknown
    try {
      decodeBytes(bytesBinaryControls())
    } catch (cause) {
      error = cause
    }
    expect(error).toBeInstanceOf(ImportError)
    expect((error as ImportError).code).toBe('binary')
  })

  it('CRLF 与孤立 CR 都归一成 LF', () => {
    const out = decodeBytes(bytesUtf8(CRLF_TEXT))
    expect(out.text.includes('\r')).toBe(false)
    expect(out.text.split('\n').length).toBe(CRLF_TEXT.split('\r\n').length)
    expect(normalizeNewlines('a\r\nb\rc\nd')).toBe('a\nb\nc\nd')
    expect(normalizeNewlines('无回车')).toBe('无回车')
  })

  it('解码质量可疑时标记为 unknown 并给出警告', () => {
    const dirty = '正常文本'.repeat(400) + REPLACEMENT.repeat(2000)
    const out = decodeBytes(bytesUtf8(dirty))
    expect(out.suspicious).toBe(true)
    expect(out.encoding).toBe('unknown')
  })

  it('空文件也能解码成空串', () => {
    const out = decodeBytes(new Uint8Array(0))
    expect(out.text).toBe('')
    expect(out.suspicious).toBe(false)
  })
})
