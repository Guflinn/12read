/**
 * PalmDOC 解压（0.3.0）。
 *
 * 五种指令各一条，加上「回看距离越界」的容错 —— 真实文件里偶尔有坏块，
 * 那时候要的是「少一个字」，不是「整本打不开」。
 */
import { describe, expect, it } from 'vitest'
import { inflatePalmDoc } from '@main/services/mobi/palmdoc'
import { palmDocCompress } from '../fixtures/mobi'

/** 把字节串写成人话，断言里好看。 */
const text = (input: Buffer): string => input.toString('latin1')

describe('inflatePalmDoc', () => {
  it('0x09..0x7F 直接输出（普通 ASCII 走这条）', () => {
    expect(text(inflatePalmDoc(Buffer.from([0x41, 0x42, 0x43])))).toBe('ABC')
  })

  it('0x01..0x08 是「后跟 n 个字面量」，0x00 是字面量 0', () => {
    // 03 后跟 3 个字面量；00 输出一个 0 字节
    const decoded = inflatePalmDoc(Buffer.from([0x03, 0x80, 0x01, 0x7f, 0x00]))
    expect(Array.from(decoded)).toEqual([0x80, 0x01, 0x7f, 0x00])
  })

  it('0xC0..0xFF 输出「空格 + (字节 & 0x7F)」', () => {
    // 0xE1 → 空格 + 0x61('a')；0xFF → 空格 + 0x7F
    expect(text(inflatePalmDoc(Buffer.from([0xe1, 0xff])))).toBe(' a \u007f')
  })

  it('0x80..0xBF 是「距离-长度」对：长度 3..10，距离回看', () => {
    // 先铺 'ABCD'，再从距离 4 处复制 3 个字节 → 'ABCDABC'
    // pair = 0x80 0x20 → ((0x8020 >> 3) & 0x7ff) = 4，长度 (0x8020 & 7) + 3 = 3
    const decoded = inflatePalmDoc(Buffer.from([0x41, 0x42, 0x43, 0x44, 0x80, 0x20]))
    expect(text(decoded)).toBe('ABCDABC')
  })

  it('长度取到上限 10（pair 低三位 = 7）', () => {
    // 0x800f: 距离 = (0x800f >> 3) & 0x7ff = 1，长度 = (0x800f & 7) + 3 = 10
    const decoded = inflatePalmDoc(Buffer.from([0x5a, 0x80, 0x0f]))
    expect(text(decoded)).toBe('Z' + 'Z'.repeat(10))
  })

  it('回看距离越界时补空格，不抛异常（坏块不该连累全书）', () => {
    // 0x8010: 距离 = (0x8010 >> 3) & 0x7ff = 2，但此刻只解出了 1 个字节 → 越界
    const decoded = inflatePalmDoc(Buffer.from([0x41, 0x80, 0x10]))
    expect(text(decoded)).toBe('A' + ' '.repeat(3))
    // 距离 0 同样按越界处理
    expect(text(inflatePalmDoc(Buffer.from([0x41, 0x80, 0x00])))).toBe('A' + ' '.repeat(3))
  })

  it('与夹具里的压缩器互为逆运算（来回一趟字节不变）', () => {
    const samples = [
      Buffer.from('第一章 起风', 'utf8'),
      Buffer.from([0x00, 0x01, 0x08, 0x09, 0x7f, 0x80, 0xbf, 0xc0, 0xff]),
      Buffer.from('风从山口进来，吹动了窗上的旧报纸。'.repeat(20), 'utf8')
    ]
    for (const sample of samples) {
      expect(inflatePalmDoc(palmDocCompress(sample)).equals(sample)).toBe(true)
    }
  })
})
