/**
 * 文件名清洗（MVP.md 3.1）。
 * 只处理文件名，不读磁盘，便于单测。
 */

/** 括号里出现这些词，说明它是版本/状态标注，不是书名的一部分。 */
const ANNOTATION_RE =
  /^(?:完结|已完结|全本|全集|番外|外传|校订|校对|精校|精排|精修|未删节|无删减|全文字|电子书|网络版|网络小说|修订版|免费|下载|txt|text)(?:版)?$/i

/** 作者末尾常见的身份词。 */
const AUTHOR_SUFFIX_RE = /\s*(?:著|编著|编|译|原著)\s*$/

export interface CleanedTitle {
  title: string
  author: string | null
}

function basename(filePath: string): string {
  const i = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return i >= 0 ? filePath.slice(i + 1) : filePath
}

/** 去掉最后一段扩展名；只认 1-5 位的字母数字扩展，避免把「1.5万字」当成扩展名。 */
function stripExtension(name: string): string {
  const i = name.lastIndexOf('.')
  if (i <= 0) return name
  const ext = name.slice(i + 1)
  return /^[A-Za-z0-9]{1,5}$/.test(ext) ? name.slice(0, i) : name
}

/** 反复剥掉结尾的【完结】/（全本）之类标注。 */
function stripAnnotations(input: string): string {
  let out = input.trim()
  for (let i = 0; i < 4; i += 1) {
    const m = /^(.*?)\s*[（(【[]\s*([^）)】\]]*)\s*[）)】]\s*$/.exec(out)
    if (!m) break
    const inner = m[2].trim()
    if (!ANNOTATION_RE.test(inner)) break
    out = m[1].trim()
  }
  return out
}

/**
 * 从路径推导书名与作者。
 * 支持 《书名》作者.txt 与 书名(完结).txt 两类；推不出来就退回原始文件名。
 */
export function cleanTitleFromPath(filePath: string): CleanedTitle {
  const raw = stripExtension(basename(filePath)).replace(/\s+/g, ' ').trim()
  if (raw.length === 0) return { title: '未命名', author: null }

  const bookish = /^《([^》]*)》\s*(.*)$/.exec(raw)
  const head = (bookish ? bookish[1] : raw).trim()
  let author = bookish ? bookish[2].trim() : ''

  let title = stripAnnotations(head)
  if (title.length === 0) title = stripAnnotations(raw)

  author = stripAnnotations(author).replace(AUTHOR_SUFFIX_RE, '').trim()

  return { title: title.length > 0 ? title : raw, author: author.length > 0 ? author : null }
}
