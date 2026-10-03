import { describe, expect, it } from 'vitest'
import { ImportError, toImportError } from '@main/services/import-error'

/**
 * toImportError 是导入失败进入 IPC 前的唯一翻译点，
 * 必须保证 code 可枚举、message 一定有中文兜底，界面才不会显示 undefined。
 */
describe('toImportError', () => {
  it('ImportError 原样返回，code 与 message 都不被覆盖', () => {
    const cause = new Error('底层原因')
    const original = new ImportError('binary', '这不是一个纯文本文件', cause)
    expect(original.name).toBe('ImportError')
    expect(original.code).toBe('binary')
    expect(original.cause).toBe(cause)

    const mapped = toImportError(original, 'unknown')
    expect(mapped).toBe(original)
    expect(mapped.code).toBe('binary')
    expect(mapped.message).toBe('这不是一个纯文本文件')
  })

  it('已经定性的 ImportError 不会被 fallback 改写', () => {
    expect(toImportError(new ImportError('cancelled', '导入已取消'), 'unknown').code).toBe('cancelled')
    expect(toImportError(new ImportError('decode-failed', '无法解码'), 'binary').code).toBe('decode-failed')
  })

  it('普通 Error 用 fallback code，message 原样保留', () => {
    const mapped = toImportError(new TypeError('无法解码该文本文件'), 'decode-failed')
    expect(mapped).toBeInstanceOf(ImportError)
    expect(mapped.code).toBe('decode-failed')
    expect(mapped.message).toBe('无法解码该文本文件')
  })

  it('TextDecoder 抛出的 TypeError 也能被翻译', () => {
    let thrown: unknown
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array([0xff, 0xfe]))
    } catch (cause) {
      thrown = cause
    }
    expect(thrown).toBeInstanceOf(Error)
    const mapped = toImportError(thrown, 'decode-failed')
    expect(mapped.code).toBe('decode-failed')
    expect(mapped.message.length).toBeGreaterThan(0)
  })

  it('AbortError 映射成 cancelled', () => {
    const aborted = new Error('The operation was aborted')
    aborted.name = 'AbortError'
    const mapped = toImportError(aborted, 'cancelled')
    expect(mapped.code).toBe('cancelled')
    expect(mapped.message).toBe('The operation was aborted')
  })

  it('message 为空的 Error 退化成“导入失败”', () => {
    const mapped = toImportError(new Error(''))
    expect(mapped.code).toBe('unknown')
    expect(mapped.message).toBe('导入失败')
  })

  it('非 Error 值被字符串化，空串仍然兜底', () => {
    expect(toImportError('炸了').message).toBe('炸了')
    expect(toImportError(42, 'io-error').code).toBe('io-error')
    expect(toImportError(42, 'io-error').message).toBe('42')
    expect(toImportError(undefined).message).toBe('undefined')
    expect(toImportError('').message).toBe('导入失败')
  })

  it('默认 fallback 是 unknown，并保留 cause 便于排查', () => {
    const cause = { code: 'EACCES' }
    const mapped = toImportError(cause)
    expect(mapped.code).toBe('unknown')
    expect(mapped.cause).toBe(cause)
    expect(mapped).toBeInstanceOf(Error)
  })
})
