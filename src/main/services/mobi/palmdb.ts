/**
 * PalmDB 容器（MOBI / AZW / PRC 的外壳，0.3.0）。
 *
 * 结构极简：78 字节文件头 + 每条记录 8 字节的索引表 + 一堆记录。
 * 头里我们只用两个字段：
 *   - 偏移 60 的类型 / 64 的创建者（`BOOK`/`MOBI`），用来在扩展名骗人时判断「这到底是不是 MOBI」
 *   - 偏移 76 的记录条数
 * 真正的内容全在记录里：记录 0 = PalmDOC 头 + MOBI 头 + EXTH，正文从记录 1 开始，
 * 之后的记录依次是索引、图片、FLIS/FCIS/SRCS 这类附加数据。
 */
import { MobiError } from './errors'

/** PalmDB 文件头固定 78 字节，记录索引表紧跟在后面。 */
const HEADER_SIZE = 78
const RECORD_ENTRY_SIZE = 8
const NUM_RECORDS_OFFSET = 76

export interface PalmDb {
  /** 记录 0 里 32 字节的书名（Palm 时代的老字段，MOBI 通常另有更干净的书名）。 */
  name: string
  /** `BOOK` / `TEXt` 这类类型码。 */
  type: string
  /** `MOBI` / `TEXt` 这类创建者码。 */
  creator: string
  records: Buffer[]
}

/**
 * 拆出所有记录。
 * 记录边界由索引表给出；索引表本身坏掉（越界、倒序）时报「这不像 MOBI」而不是越界崩。
 */
export function parsePalmDb(bytes: Buffer): PalmDb {
  if (bytes.length < HEADER_SIZE + RECORD_ENTRY_SIZE) {
    throw new MobiError('这个文件太小了，不像是一本 MOBI 电子书')
  }
  const count = bytes.readUInt16BE(NUM_RECORDS_OFFSET)
  if (count === 0 || HEADER_SIZE + count * RECORD_ENTRY_SIZE > bytes.length) {
    throw new MobiError('这个文件不是有效的 MOBI 电子书（记录索引表不完整）')
  }

  const offsets: number[] = []
  for (let index = 0; index < count; index += 1) {
    offsets.push(bytes.readUInt32BE(HEADER_SIZE + index * RECORD_ENTRY_SIZE))
  }
  offsets.push(bytes.length)

  for (let index = 0; index < count; index += 1) {
    const start = offsets[index] as number
    const end = offsets[index + 1] as number
    if (start > end || end > bytes.length) {
      throw new MobiError('这个文件不是有效的 MOBI 电子书（记录索引表越界）')
    }
  }

  const records: Buffer[] = []
  for (let index = 0; index < count; index += 1) {
    records.push(bytes.subarray(offsets[index], offsets[index + 1]))
  }

  return {
    name: readCString(bytes.subarray(0, 32)),
    type: readCString(bytes.subarray(60, 64)),
    creator: readCString(bytes.subarray(64, 68)),
    records
  }
}

function readCString(bytes: Buffer): string {
  const end = bytes.indexOf(0)
  return bytes.subarray(0, end < 0 ? bytes.length : end).toString('latin1').trim()
}
