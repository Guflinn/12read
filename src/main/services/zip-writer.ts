/**
 * 手写 ZIP 写入器（0.1.3 第 9 项：导出备份）。
 * 只为不引新依赖：备份包里是正文与 SQLite 文件，deflate 一个方法就够，
 * 于是这里只实现单卷、不做 Zip64 的最小集合（整库远小于 4GB）。
 */
import { deflateRaw } from 'node:zlib'

export interface ZipEntry {
  /** 包内路径，一律用 '/' 分隔。 */
  path: string
  data: Buffer
}

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50
const METHOD_STORE = 0
const METHOD_DEFLATE = 8
/** 通用位 11：文件名是 UTF-8。留着它，包里真有中文名字也不会花。 */
const FLAG_UTF8 = 0x0800
const VERSION = 20
const MAX_ENTRIES = 0xffff

/** 标准 CRC-32（IEEE 802.3）查表。 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

export function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (let index = 0; index < data.length; index += 1) {
    crc = CRC_TABLE[(crc ^ data[index]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** MS-DOS 的时间戳：秒只有 2 秒精度，1980 年之前一律夹到 1980。 */
function dosStamp(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear())
  const month = date.getMonth() + 1
  const day = date.getDate()
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | (month << 5) | day
  }
}

function deflateRawAsync(data: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    deflateRaw(data, (error, result) => {
      if (error) reject(error)
      else resolve(result)
    })
  })
}

/**
 * 打包成一份 zip。用异步 deflate 逐条压，主进程在等压缩时还能处理别的 IPC；
 * 压完反而变大（小文件、已压过的二进制）就退回 STORE。
 */
export async function createZip(entries: ZipEntry[], now: Date = new Date()): Promise<Buffer> {
  if (entries.length > MAX_ENTRIES) {
    throw new Error('备份条目太多，单个 zip 最多 ' + MAX_ENTRIES + ' 条')
  }

  const stamp = dosStamp(now)
  const locals: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8')
    const crc = crc32(entry.data)
    const deflated = await deflateRawAsync(entry.data)
    const useDeflate = deflated.length < entry.data.length
    const payload = useDeflate ? deflated : entry.data
    const method = useDeflate ? METHOD_DEFLATE : METHOD_STORE

    const local = Buffer.alloc(30)
    local.writeUInt32LE(SIG_LOCAL, 0)
    local.writeUInt16LE(VERSION, 4)
    local.writeUInt16LE(FLAG_UTF8, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(stamp.time, 10)
    local.writeUInt16LE(stamp.date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)

    const head = Buffer.alloc(46)
    head.writeUInt32LE(SIG_CENTRAL, 0)
    head.writeUInt16LE(VERSION, 4)
    head.writeUInt16LE(VERSION, 6)
    head.writeUInt16LE(FLAG_UTF8, 8)
    head.writeUInt16LE(method, 10)
    head.writeUInt16LE(stamp.time, 12)
    head.writeUInt16LE(stamp.date, 14)
    head.writeUInt32LE(crc, 16)
    head.writeUInt32LE(payload.length, 20)
    head.writeUInt32LE(entry.data.length, 24)
    head.writeUInt16LE(name.length, 28)
    head.writeUInt16LE(0, 30)
    head.writeUInt16LE(0, 32)
    head.writeUInt16LE(0, 34)
    head.writeUInt16LE(0, 36)
    head.writeUInt32LE(0, 38)
    head.writeUInt32LE(offset, 42)

    locals.push(local, name, payload)
    central.push(head, name)
    offset += local.length + name.length + payload.length
  }

  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(SIG_EOCD, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([...locals, directory, end])
}
