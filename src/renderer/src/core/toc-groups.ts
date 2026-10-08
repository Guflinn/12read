import type { Chapter } from '@shared/types'

/**
 * 目录按「卷 / 册」分组（0.2.0）：合集类 EPUB（一个文件装十几本书）才有 groupTitle，
 * 普通书与 TXT 全是 null —— 那时这个函数原样返回一组，界面与以前完全一样。
 *
 * 为什么单独做一层：目录抽屉要画出「这是哪本书」的分隔，但**章节表本身是平的**——
 * 分组只是展示层的切分，不改数据、不影响阅读位置。
 */
export interface TocGroupItem {
  chapter: Chapter
  /** 它在整个章节表里的下标（渲染 key、跳转都用它）。 */
  index: number
  /** 是「节」：直接父级不是本册（三级目录最深那层），界面缩进显示。 */
  section: boolean
  /**
   * 要在这一条前面画一行「章名」：当这一章的标题页被并进小节、章本身不再单独成行时，
   * 用父级标题补一行分组小标题，免得目录里把章名丢了。没有就是 null。
   */
  subHeader: string | null
}

export interface TocGroup {
  /** 卷 / 册名；没有分组时为 null。 */
  title: string | null
  /**
   * 点组标题那一行跳到哪儿（该册首页的章节下标）；没有分组时为 null。
   * 组名与组内第一项同名时，那一项不再单独列出 —— 点组标题就是点它。
   */
  headerJump: number | null
  items: TocGroupItem[]
}

/** 按 groupTitle 把**连续的**章节切成组（顺序保持不变）。 */
export function groupChapters(chapters: readonly Chapter[]): TocGroup[] {
  const groups: TocGroup[] = []
  /**
   * 按**册名**归组（第一次出现的次序），而不是按「相邻」。
   *
   * 为什么：真实书的目录里偶有一两条挂错位置 —— 那本合集的「版权页」在 NCX 里属于《蛙》，
   * 但正文位置在全书最末尾，于是相邻分组会切成「我們的荊軻 → 蛙 → 我們的荊軻」两个同名组，
   * 目录上看起来就像凭空多出一遍册名（用户 2026-10-08 的反馈）。
   * 按名字归组后，错位的那条会回到它该在的那一册里。
   */
  chapters.forEach((chapter, index) => {
    const title = chapter.groupTitle ?? null
    const last = groups[groups.length - 1]
    if (last && last.title === title) {
      last.items.push({ chapter, index, section: false, subHeader: null })
      return
    }
    groups.push({
      title,
      headerJump: title === null ? null : index,
      items: [{ chapter, index, section: false, subHeader: null }]
    })
  })

  /*
   * 兜底：把「挂错位置的小组」并回同名的那一册。
   *
   * 那本合集的「版权页」在 NCX 里属于《蛙》、正文位置却在全书末尾，于是相邻分组会切成
   * 「我們的荊軻 → 蛙 → 我們的荊軻」两个同名组（用户看到「多了一个蛙」就是这个）。
   * 只并**有名的小组**（≤2 条）：无分组的 null 组是正常情况（普通书前后几章都不属于任何一册），
   * 合并它们会把顺序搞乱 —— 这条是被 EPUB 的 e2e 逮到的。
   */
  const named = new Map<string, TocGroup>()
  const reunited: TocGroup[] = []
  for (const group of groups) {
    if (group.title === null) {
      reunited.push(group)
      continue
    }
    const existing = named.get(group.title)
    if (existing !== undefined && group.items.length <= 2) {
      existing.items.push(...group.items)
      continue
    }
    if (existing === undefined) named.set(group.title, group)
    reunited.push(group)
  }
  groups.length = 0
  groups.push(...reunited)

  const norm = (value: string): string => value.replace(/[\s\u00a0\u3000]+/g, '')

  for (const group of groups) {
    const titlesInGroup = new Set(group.items.map((item) => item.chapter.title))
    for (const item of group.items) {
      item.section =
        group.title !== null &&
        item.chapter.parentTitle != null &&
        item.chapter.parentTitle !== group.title
    }

    // 组名与组内第一项同名（那一行就是这本书的扉页）：不再单独列它，
    // 点组标题那一行就等于点它 —— 免得出现「天堂蒜薹之歌 / 天堂蒜薹之歌」两行。
    // 判断用「包含」而不是「相等」：真实书里那一行的标题常常更长，
    // 比如《我們的荊軻》的首页标题写成「我們的荊軻 || 劇中…」，用相等就漏掉了。
    const first = group.items[0]
    if (group.title !== null && first !== undefined) {
      const a = norm(first.chapter.title)
      const b = norm(group.title)
      if (a === b || a.includes(b) || b.includes(a)) group.items.shift()
    }

    // 章标题页被并进小节之后，章名在章节表里不存在了 —— 用父级标题补一行小标题，
    // 免得读者在目录里找不到「第一章」这一层。
    let previousParent = group.title
    for (const item of group.items) {
      const parent = item.chapter.parentTitle ?? null
      if (
        group.title !== null &&
        parent !== null &&
        parent !== group.title &&
        parent !== previousParent &&
        !titlesInGroup.has(parent)
      ) {
        item.subHeader = parent
      }
      if (parent !== null) previousParent = parent
    }
  }
  return groups
}
