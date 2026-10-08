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
  chapters.forEach((chapter, index) => {
    const title = chapter.groupTitle ?? null
    const last = groups[groups.length - 1]
    if (last && last.title === title) {
      last.items.push({ chapter, index, section: false })
      return
    }
    groups.push({
      title,
      headerJump: title === null ? null : index,
      items: [{ chapter, index, section: false }]
    })
  })

  for (const group of groups) {
    for (const item of group.items) {
      item.section =
        group.title !== null &&
        item.chapter.parentTitle != null &&
        item.chapter.parentTitle !== group.title
    }
    // 组名与组内第一项同名（那一行就是这本书的扉页）：不再单独列它，
    // 点组标题那一行就等于点它 —— 免得出现「天堂蒜薹之歌 / 天堂蒜薹之歌」两行。
    const first = group.items[0]
    if (group.title !== null && first !== undefined && first.chapter.title === group.title) {
      group.items.shift()
    }
  }
  return groups
}
