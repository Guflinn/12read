import type { ManualEncoding } from '@shared/types'

export interface EncodingChoice {
  value: ManualEncoding
  label: string
  hint: string
}

/**
 * 重新解码时可选的编码。
 * 自动检测永远拿不准 GBK / BIG5 这类中文编码，所以给用户一个手动指定的入口；
 * 顺序按「先试最可能的」排：自动 → UTF-8 → GBK → BIG5 → 两种 UTF-16。
 */
export const ENCODING_CHOICES: readonly EncodingChoice[] = [
  { value: 'auto', label: '自动检测', hint: '再猜一次（UTF-8 → GBK → UTF-16）' },
  { value: 'utf-8', label: 'UTF-8', hint: '现在的通用编码，含繁体' },
  { value: 'gb18030', label: 'GBK / GB18030', hint: '简体老书最常见' },
  { value: 'big5', label: 'BIG5', hint: '繁体老书（台湾 / 香港）' },
  { value: 'utf-16le', label: 'UTF-16 LE', hint: 'Windows 记事本另存为的 Unicode' },
  { value: 'utf-16be', label: 'UTF-16 BE', hint: '少见，大端序 UTF-16' }
]
