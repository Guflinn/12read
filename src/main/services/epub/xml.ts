/**
 * 手写 lenient XML 解析器（0.2.0：EPUB 的 container.xml / OPF / nav / NCX 都是 XML）。
 *
 * 与 zip-reader 同样的立场：**不引依赖，也不追求标准完备**。这里只做电子书里真正会遇到的事：
 * - 只读、只需要「元素树 + 属性 + 文本」，不校验 schema、不解析 DTD、不管命名空间语义
 *   （标签名与属性名**连前缀原样留着**，`dc:title` 就是 `dc:title`，配对用 `localName()` 比）
 * - **lenient**：标签不闭合、闭合标签对不上、奇怪的注释与 DOCTYPE，一律尽力恢复继续读，
 *   而不是整本打不开 —— 真实电子书里坏 XML 太常见了
 * - 实体解码：`&amp; &lt; &gt; &quot; &apos;` + 数字实体（十进制与十六进制）；
 *   `&#x20;` 这类在正文里也常见，漏了就会把「&」原样显示给读者
 * - CDATA 当文本
 *
 * 故意不做的事：命名空间解析、DTD / 实体声明、XInclude、注释保留、行号定位。
 */

export interface XmlNode {
  /** 标签名，含命名空间前缀原样（`dc:title`）。 */
  tag: string
  /** 属性名同样含前缀原样。 */
  attrs: Record<string, string>
  children: XmlNode[]
  /** 直接文本（不含子元素里的），已解实体。 */
  text: string
}

/** 取本地名：`dc:title` → `title`；没有前缀就原样。 */
export function localName(tag: string): string {
  const at = tag.indexOf(':')
  return at < 0 ? tag : tag.slice(at + 1)
}

/** 按本地名找直接子元素（大小写不敏感：有些书把 `<Body>` 写成大写）。 */
export function childrenNamed(node: XmlNode, name: string): XmlNode[] {
  const wanted = name.toLowerCase()
  return node.children.filter((child) => localName(child.tag).toLowerCase() === wanted)
}

export function firstChild(node: XmlNode, name: string): XmlNode | null {
  return childrenNamed(node, name)[0] ?? null
}

/** 深度优先按本地名找第一个后代。 */
export function findDescendant(node: XmlNode, name: string): XmlNode | null {
  const wanted = name.toLowerCase()
  for (const child of node.children) {
    if (localName(child.tag).toLowerCase() === wanted) return child
    const deeper = findDescendant(child, name)
    if (deeper) return deeper
  }
  return null
}

/** 收集所有后代（含自身）里本地名匹配的节点。 */
export function allDescendants(node: XmlNode, name: string): XmlNode[] {
  const wanted = name.toLowerCase()
  const found: XmlNode[] = []
  const walk = (current: XmlNode): void => {
    if (localName(current.tag).toLowerCase() === wanted) found.push(current)
    for (const child of current.children) walk(child)
  }
  walk(node)
  return found
}

/** 节点内所有文本（含子孙），拼接后 trim —— 取书名、作者、目录标题用。 */
export function textOf(node: XmlNode): string {
  let out = node.text
  for (const child of node.children) out += textOf(child)
  return out.replace(/\s+/g, ' ').trim()
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0'
}

/** 解 XML 实体；认不出来的一律原样留着（宁可显示 `&foo;` 也别吞掉两个字）。 */
export function decodeEntities(input: string): string {
  if (!input.includes('&')) return input
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X'
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10)
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole
      try {
        return String.fromCodePoint(code)
      } catch {
        return whole
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole
  })
}

function isNameChar(char: string): boolean {
  return !/[\s/>]/.test(char)
}

/** 解析属性串（`a="1" b='2' c`）→ 对象；重复的取后一个，没值的给空串。 */
function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  let at = 0
  while (at < source.length) {
    while (at < source.length && /\s/.test(source[at] as string)) at += 1
    if (at >= source.length) break
    const nameStart = at
    while (at < source.length && !/[\s=]/.test(source[at] as string)) at += 1
    const name = source.slice(nameStart, at)
    if (name === '') break
    while (at < source.length && /\s/.test(source[at] as string)) at += 1
    let value = ''
    if (source[at] === '=') {
      at += 1
      while (at < source.length && /\s/.test(source[at] as string)) at += 1
      const quote = source[at]
      if (quote === '"' || quote === "'") {
        at += 1
        const valueStart = at
        while (at < source.length && source[at] !== quote) at += 1
        value = source.slice(valueStart, at)
        at += 1
      } else {
        const valueStart = at
        while (at < source.length && !/[\s>]/.test(source[at] as string)) at += 1
        value = source.slice(valueStart, at)
      }
    }
    attrs[name] = decodeEntities(value)
  }
  return attrs
}

/**
 * 把 XML 读成一棵树。返回根元素（文档里第一个元素）；没有元素时返回 null。
 * 坏标签尽力恢复：闭合对不上就往上找同名的祖先，找不到就忽略这个闭合标签。
 */
export function parseXml(source: string): XmlNode | null {
  const stack: XmlNode[] = []
  let root: XmlNode | null = null
  let at = 0

  const pushText = (raw: string): void => {
    if (raw === '' || stack.length === 0) return
    const target = stack[stack.length - 1]
    if (target) target.text += decodeEntities(raw)
  }

  while (at < source.length) {
    const next = source.indexOf('<', at)
    if (next < 0) {
      pushText(source.slice(at))
      break
    }
    pushText(source.slice(at, next))
    at = next

    // XML 声明 / 处理指令
    if (source.startsWith('<?', at)) {
      const end = source.indexOf('?>', at)
      at = end < 0 ? source.length : end + 2
      continue
    }
    // 注释
    if (source.startsWith('<!--', at)) {
      const end = source.indexOf('-->', at)
      at = end < 0 ? source.length : end + 3
      continue
    }
    // CDATA：原样当文本（不再解实体）
    if (source.startsWith('<![CDATA[', at)) {
      const end = source.indexOf(']]>', at)
      const body = source.slice(at + 9, end < 0 ? source.length : end)
      const target = stack[stack.length - 1]
      if (target) target.text += body
      at = end < 0 ? source.length : end + 3
      continue
    }
    // DOCTYPE / 其他 <! 声明：跳到 >（带内部子集的多跳一层 ]）
    if (source.startsWith('<!', at)) {
      let end = source.indexOf('>', at)
      const bracket = source.indexOf('[', at)
      if (bracket >= 0 && (end < 0 || bracket < end)) {
        const close = source.indexOf(']', bracket)
        end = close < 0 ? source.indexOf('>', bracket) : source.indexOf('>', close)
      }
      at = end < 0 ? source.length : end + 1
      continue
    }
    // 闭合标签
    if (source.startsWith('</', at)) {
      const end = source.indexOf('>', at)
      const name = source.slice(at + 2, end < 0 ? source.length : end).trim()
      for (let depth = stack.length - 1; depth >= 0; depth -= 1) {
        if (stack[depth]?.tag === name) {
          stack.length = depth
          break
        }
      }
      at = end < 0 ? source.length : end + 1
      continue
    }

    // 开标签
    const end = source.indexOf('>', at)
    if (end < 0) break
    const raw = source.slice(at + 1, end)
    const selfClosing = raw.endsWith('/')
    const body = selfClosing ? raw.slice(0, -1) : raw
    let nameEnd = 0
    while (nameEnd < body.length && isNameChar(body[nameEnd] as string)) nameEnd += 1
    const tag = body.slice(0, nameEnd)
    at = end + 1
    if (tag === '') continue

    const node: XmlNode = { tag, attrs: parseAttrs(body.slice(nameEnd)), children: [], text: '' }
    const parent = stack[stack.length - 1]
    if (parent) parent.children.push(node)
    else if (root === null) root = node

    if (!selfClosing) stack.push(node)
  }

  return root
}
