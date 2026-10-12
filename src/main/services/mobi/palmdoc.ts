/**
 * PalmDOC 解压（MOBI 正文的两种压缩之一，compression = 2）。
 *
 * MOBI 的正文按「记录」切块（常见每块 4096 字节原文），每块独立压缩。PalmDOC 是
 * LZ77 的一个极简变体，只有三种指令：
 *   0x00          → 输出一个 0x00 字节
 *   0x01..0x08    → 后面紧跟 n 个字节原样输出（n 就是要转义的字节本身）
 *   0x09..0x7F    → 直接输出这个字节（绝大多数 ASCII / 半角字符走这条）
 *   0x80..0xBF    → 两字节「距离-长度」对：长度 3..10，距离回看 1..2047
 *   0xC0..0xFF    → 输出一个空格 + (该字节 & 0x7F)，用来省掉「空格+字符」两个字节
 *
 * 不用 Buffer 预分配：单块最大也就几 KB，逐字节 push 进数组更直白，也便于单测。
 */

/** 「距离-长度」对里的常量：长度 3..10（3 是基准），距离回看 1..2047。 */
const PAIR_LENGTH_MIN = 3
const PAIR_DISTANCE_MAX = 0x07ff

export function inflatePalmDoc(input: Buffer): Buffer {
  const output: number[] = []
  let at = 0

  while (at < input.length) {
    const control = input[at] as number
    at += 1

    if (control === 0) {
      output.push(0)
      continue
    }
    if (control <= 8) {
      for (let count = 0; count < control && at < input.length; count += 1) {
        output.push(input[at] as number)
        at += 1
      }
      continue
    }
    if (control <= 0x7f) {
      output.push(control)
      continue
    }
    if (control <= 0xbf) {
      const next = at < input.length ? (input[at] as number) : 0
      at += 1
      const pair = (control << 8) | next
      const length = (pair & 0x07) + PAIR_LENGTH_MIN
      const distance = (pair >> 3) & PAIR_DISTANCE_MAX
      // 回看距离必须落在已经解出来的内容里。坏文件里偶尔越界，这里补空格而不是抛错：
      // 少一个字比整本打不开好，而且压缩流损坏通常只是个别块，不该连累全书（与 xml 解析同样的立场）。
      if (distance === 0 || distance > output.length) {
        for (let count = 0; count < length; count += 1) output.push(0x20)
        continue
      }
      for (let count = 0; count < length; count += 1) {
        output.push(output[output.length - distance] as number)
      }
      continue
    }
    // 0xC0..0xFF
    output.push(0x20)
    output.push(control ^ 0x80)
  }

  return Buffer.from(output)
}
