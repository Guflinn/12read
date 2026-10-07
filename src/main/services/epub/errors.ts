/**
 * EPUB 解析过程中的「这本书读不了」：message 一律是给用户看的中文，
 * 由导入链路翻成导入失败的提示（与 zip-reader 的 ZipError 同一套路）。
 */
export class EpubError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EpubError'
  }
}

/**
 * 包内路径归一化：解 %xx、去掉 `#片段`、把 `./` 与 `../` 算掉，统一用 '/'。
 *
 * 为什么要做：EPUB 里的 href 是相对路径，而且**五花八门** —— `Text/ch1.xhtml`、
 * `./Text/ch1.xhtml`、`Text/../Text/ch1.xhtml`、`Text/ch%201.xhtml` 都见过。
 * 归一化到一个形状，后面按名字取 ZIP 条目才稳。
 */
export function normalizePath(base: string, href: string): string {
  let decoded = href
  try {
    decoded = decodeURIComponent(href)
  } catch {
    // 坏转义（`%E0%A4` 这种残的）就按原样用，别整本书打不开
  }
  const withoutFragment = decoded.split('#')[0] ?? ''
  const parts = (withoutFragment.startsWith('/')
    ? withoutFragment.slice(1)
    : base === ''
      ? withoutFragment
      : base + '/' + withoutFragment
  ).split('/')

  const stack: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      stack.pop()
      continue
    }
    stack.push(part)
  }
  return stack.join('/')
}

/** 包内路径所在目录（`OEBPS/content.opf` → `OEBPS`；根目录给空串）。 */
export function dirOf(path: string): string {
  const at = path.lastIndexOf('/')
  return at < 0 ? '' : path.slice(0, at)
}
