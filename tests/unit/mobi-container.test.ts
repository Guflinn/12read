/**
 * PalmDB 容器 + PalmDOC 头 + MOBI 头 + EXTH（0.3.0）。
 *
 * 全部拿夹具当输入：夹具是按真书实测的字段布局写的（真书：白夜行，MOBI6 / PalmDOC /
 * headerLength 232 / firstImageIndex 240 / extraDataFlags 0x0B），
 * 所以这里断言的位置就是真书里的位置。
 */
import { describe, expect, it } from 'vitest'
import {
  EXTH_AUTHOR,
  EXTH_COVER_OFFSET,
  EXTH_TITLE,
  exthNumber,
  exthText,
  parseExth,
  readMobiHeader,
  readPalmDocHeader
} from '@main/services/mobi/header'
import { parsePalmDb } from '@main/services/mobi/palmdb'
import { DEFAULT_MOBI_HTML, FAKE_JPEG, createMobi } from '../fixtures/mobi'

describe('parsePalmDb', () => {
  it('拆出全部记录，并读出类型 / 创建者 / 老书名', () => {
    const db = parsePalmDb(createMobi({ title: '测试小书' }))
    expect(db.type).toBe('BOOK')
    expect(db.creator).toBe('MOBI')
    // PalmDB 的 32 字节老书名字段是单字节编码，MOBI 实际书名走 EXTH / full name
    expect(db.name).toBe('TestBook')
    // 记录 0 + 正文块 + 封面
    expect(db.records.length).toBeGreaterThanOrEqual(3)
  })

  it('文件太小 / 索引表不完整 / 索引越界都要报「不是有效的 MOBI」（中文，能直接给用户看）', () => {
    expect(() => parsePalmDb(Buffer.alloc(10))).toThrow(/太小了/)
    expect(() => parsePalmDb(Buffer.alloc(100))).toThrow(/记录索引表不完整/)
    const broken = Buffer.alloc(200)
    broken.writeUInt16BE(4, 76) // 声称 4 条记录，但索引表指向文件外
    broken.writeUInt32BE(0xffff, 78)
    expect(() => parsePalmDb(broken)).toThrow(/索引表越界/)
  })
})

describe('PalmDOC 头 / MOBI 头', () => {
  it('读压缩方式、正文长度、块数与每块上限', () => {
    const html = DEFAULT_MOBI_HTML
    const db = parsePalmDb(createMobi({ html, recordSize: 64 }))
    const palm = readPalmDocHeader(db.records[0] as Buffer)
    expect(palm.compression).toBe(2)
    expect(palm.textLength).toBe(Buffer.byteLength(html, 'utf8'))
    expect(palm.recordSize).toBe(64)
    expect(palm.recordCount).toBe(Math.ceil(Buffer.byteLength(html, 'utf8') / 64))
    expect(palm.encryption).toBe(0)
  })

  it('读版本 / 编码 / firstImageIndex / 额外数据标志 / 头里的书名', () => {
    const db = parsePalmDb(createMobi({ title: '测试小书', trailingBytes: 4, extraDataFlags: 0x02 }))
    const header = readMobiHeader(db.records[0] as Buffer)
    expect(header.version).toBe(6)
    expect(header.textEncoding).toBe(65001)
    expect(header.fullName).toBe('测试小书')
    expect(header.extraDataFlags).toBe(0x02)
    // 记录 0 + 正文块之后才是图片
    expect(header.firstImageIndex).toBe(1 + readPalmDocHeader(db.records[0] as Buffer).recordCount)
  })

  it('没有 MOBI 头时报错（扩展名骗人时给的就是这句话）', () => {
    const db = parsePalmDb(createMobi())
    const broken = Buffer.from(db.records[0] as Buffer)
    broken.write('XXXX', 16, 'latin1')
    expect(() => readMobiHeader(broken)).toThrow(/没有 MOBI 头/)
  })
})

describe('EXTH', () => {
  it('读出作者 / 书名 / 封面下标', () => {
    const db = parsePalmDb(createMobi({ title: '夜行', author: '某人', cover: FAKE_JPEG }))
    const record0 = db.records[0] as Buffer
    const header = readMobiHeader(record0)
    const exth = parseExth(record0, header)

    expect(exthText(exth, EXTH_TITLE, header.textEncoding)).toBe('夜行')
    expect(exthText(exth, EXTH_AUTHOR, header.textEncoding)).toBe('某人')
    expect(exthNumber(exth, EXTH_COVER_OFFSET)).toBe(0)
  })

  it('没有 EXTH 时给空表（老文件不能因此打不开）', () => {
    const db = parsePalmDb(createMobi({ withExth: false }))
    const record0 = db.records[0] as Buffer
    const header = readMobiHeader(record0)
    const exth = parseExth(record0, header)
    expect(exth.size).toBe(0)
    expect(exthText(exth, EXTH_TITLE, header.textEncoding)).toBeNull()
    // 书名退回 MOBI 头里的 full name
    expect(header.fullName).toBe('测试小书')
  })

  it('坏长度（连 8 字节头都装不下）时停下来，不越界读垃圾', () => {
    const db = parsePalmDb(createMobi())
    const record0 = db.records[0] as Buffer
    const header = readMobiHeader(record0)
    const broken = Buffer.from(record0)
    broken.writeUInt32BE(4, 16 + header.headerLength + 12 + 4) // 第一条的长度字段改成 4
    expect(parseExth(broken, header).size).toBe(0)
  })
})
