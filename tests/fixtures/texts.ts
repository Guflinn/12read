/**
 * 测试夹具（TECH.md 6.2 / 7.1）。
 * 编码样本在内存里生成，仓库里不放二进制文件；生成结果本身就是夹具。
 */
import * as iconv from 'iconv-lite'

export const SAMPLE_TEXT =
  '第一章 初见\n他推开门，屋里的煤油灯还亮着。\n第二章 归途\n雨停了，泥路泛着光。\n'

export const CHAPTERED_TEXT = [
  '这是一部小说的开篇引言，没有章节标记。',
  '',
  '第一章 初见',
  '他推开门，屋里的煤油灯还亮着。',
  '',
  '第二章 归途',
  '雨停了，泥路泛着光。',
  '',
  '序章 其实这里是标记',
  '正文继续。',
  ''
].join('\n')

/** 只有一个标记，应该走兜底分段。 */
export const SINGLE_MARKER_TEXT =
  '正文正文正文。\n第一章 只有这一章\n后面的内容继续。\n再写一点。\n'

/** 正文里出现“第一章”但整行远超 40 字，属于误伤场景。 */
export const FALSE_POSITIVE_TEXT =
  '作者在第一章节里详细讲述了主角的身世，这一段足足写了很多很多字，远超四十个字符上限。\n' +
  '第一章 真正的标题\n正文。\n第二章 第二个标题\n正文。\n'

export const CRLF_TEXT = '前言部分。\r\n第一章 标题甲\r\n正文甲。\r\n第二章 标题乙\r\n正文乙。\r\n'

export const MIXED_TEXT = '第一章 开始\nHello world 🌏 中文混排。\n第二章 结束\nEmoji 🚀 也要算两个 code unit。\n'

export const UNCHAPTERED_TEXT = Array.from(
  { length: 30 },
  (_, i) => '这是第' + (i + 1) + '段正文，用来测试定长分段兜底是否稳定。'.repeat(20)
).join('\n')

export const EMPTY_TEXT = ''

export function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

export function bytesUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

export function bytesUtf8Bom(text: string): Uint8Array {
  return concat([new Uint8Array([0xef, 0xbb, 0xbf]), bytesUtf8(text)])
}

export function bytesUtf16leBom(text: string): Uint8Array {
  return concat([new Uint8Array([0xff, 0xfe]), new Uint8Array(iconv.encode(text, 'utf16-le'))])
}

export function bytesUtf16beBom(text: string): Uint8Array {
  return concat([new Uint8Array([0xfe, 0xff]), new Uint8Array(iconv.encode(text, 'utf16-be'))])
}

/** GBK/GB18030 样本：iconv 用 gb18030 编码，检测侧也应回落到 gb18030。 */
export function bytesGbk(text: string = SAMPLE_TEXT): Uint8Array {
  return new Uint8Array(iconv.encode(text, 'gb18030'))
}

/** 真二进制：含 NUL。 */
export function bytesBinaryWithNul(): Uint8Array {
  return new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x08, 0x00, 0x01, 0x02, 0x03])
}

/** 无 NUL 但控制字符占比很高。 */
export function bytesBinaryControls(): Uint8Array {
  const out = new Uint8Array(64)
  for (let i = 0; i < out.length; i += 1) out[i] = i % 8 === 0 ? 0x1b : 0x01
  return out
}

/** 解码后体检用的脏文本：大量 U+FFFD。 */
export function textWithReplacements(count: number): string {
  return '正常文本'.repeat(count) + '\uFFFD'.repeat(count * 5)
}
