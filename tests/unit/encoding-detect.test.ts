import { describe, expect, it } from 'vitest'
import {
  assessDecodedText,
  detectBom,
  detectEncoding,
  isValidUtf8,
  looksBinary
} from '@shared/core/encoding-detect'
import {
  bytesBinaryControls,
  bytesBinaryWithNul,
  bytesGbk,
  bytesUtf16beBom,
  bytesUtf16leBom,
  bytesUtf8,
  bytesUtf8Bom,
  SAMPLE_TEXT,
  textWithReplacements
} from '../fixtures/texts'

describe('编码检测', () => {
  it('无 BOM 的 UTF-8 判为 utf-8', () => {
    const det = detectEncoding(bytesUtf8(SAMPLE_TEXT))
    expect(det.encoding).toBe('utf-8')
    expect(det.binary).toBe(false)
    expect(det.bomLength).toBe(0)
  })

  it('识别 UTF-8 BOM 并给出跳过字节数', () => {
    const det = detectEncoding(bytesUtf8Bom(SAMPLE_TEXT))
    expect(det.encoding).toBe('utf-8-bom')
    expect(det.bomLength).toBe(3)
  })

  it('识别 UTF-16LE / UTF-16BE BOM', () => {
    expect(detectEncoding(bytesUtf16leBom(SAMPLE_TEXT)).encoding).toBe('utf-16le')
    expect(detectEncoding(bytesUtf16beBom(SAMPLE_TEXT)).encoding).toBe('utf-16be')
    expect(detectEncoding(bytesUtf16leBom(SAMPLE_TEXT)).bomLength).toBe(2)
  })

  it('GBK 正文回落 gb18030，且不被当成二进制', () => {
    const det = detectEncoding(bytesGbk())
    expect(det.encoding).toBe('gb18030')
    expect(det.binary).toBe(false)
    expect(det.reason).toBe('fallback-gb18030')
  })

  it('含 NUL 的文件判为二进制', () => {
    const det = detectEncoding(bytesBinaryWithNul())
    expect(det.binary).toBe(true)
    expect(det.encoding).toBe('unknown')
    expect(det.reason).toBe('binary')
  })

  it('控制字符占比过高也判为二进制', () => {
    expect(looksBinary(bytesBinaryControls())).toBe(true)
    expect(detectEncoding(bytesBinaryControls()).binary).toBe(true)
  })

  it('空文件按 UTF-8 处理，不报二进制', () => {
    const det = detectEncoding(new Uint8Array(0))
    expect(det.binary).toBe(false)
    expect(det.reason).toBe('empty')
  })

  it('严格 UTF-8 校验能区分 GBK 与 UTF-8', () => {
    expect(isValidUtf8(bytesUtf8(SAMPLE_TEXT))).toBe(true)
    expect(isValidUtf8(bytesGbk())).toBe(false)
  })

  it('取样截断在多字节字符中间时不会误判', () => {
    const long = bytesUtf8('中'.repeat(200_000))
    expect(isValidUtf8(long)).toBe(true)
  })

  it('BOM 优先于二进制嗅探（UTF-16 天然含 0x00）', () => {
    expect(bytesUtf16leBom('第一章').includes(0)).toBe(true)
    expect(detectEncoding(bytesUtf16leBom('第一章')).binary).toBe(false)
  })

  it('detectBom 对普通 UTF-8 返回 null', () => {
    expect(detectBom(bytesUtf8('abc'))).toBeNull()
  })

  it('解码体检：正常文本不报警，U+FFFD 过多则报警', () => {
    expect(assessDecodedText(SAMPLE_TEXT).suspicious).toBe(false)
    const dirty = assessDecodedText(textWithReplacements(200))
    expect(dirty.suspicious).toBe(true)
    expect(dirty.replacementRatio).toBeGreaterThan(0.002)
  })

  it('解码体检：私用区字符过多也会报警', () => {
    const privateUse = '\uE000'.repeat(500) + '正常'.repeat(100)
    expect(assessDecodedText(privateUse).suspicious).toBe(true)
  })

  it('解码体检对空串不抛异常', () => {
    const health = assessDecodedText('')
    expect(health.suspicious).toBe(false)
    expect(health.sampledChars).toBe(0)
  })
})
