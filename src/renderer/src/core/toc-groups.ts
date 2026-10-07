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
  /** 是不是本组的第一条 —— 界面用它画「册首」样式（哪怕不单独画组名也能看出书界）。 */
  first: boolean
}

export interface TocGroup {
  /** 卷 / 册名；没有分组时为 null。 */
  title: string | null
  /**
   * 要不要单独画一行组标题。
   * 组内第一项标题与组名相同时不画 —— 那一条本身就是这本书的扉页，
   * 再画一行组名就成了「天堂蒜薹之歌 / 天堂蒜薹之歌」的重复；
   * 这时靠 `first` 标记把那一行染成册首样式，书界照样看得出来。
   */
  showHeader: boolean
  items: TocGroupItem[]
}

/** 按 groupTitle 把**连续的**章节切成组（顺序保持不变）。 */
export function groupChapters(chapters: readonly Chapter[]): TocGroup[] {
  const groups: TocGroup[] = []
  chapters.forEach((chapter, index) => {
    const title = chapter.groupTitle ?? null
    const last = groups[groups.length - 1]
    if (last && last.title === title) {
      last.items.push({ chapter, index, first: false })
      return
    }
    groups.push({ title, showHeader: false, items: [{ chapter, index, first: false }] })
  })
  for (const group of groups) {
    group.showHeader = group.title !== null && group.items[0]?.chapter.title !== group.title
    group.items.forEach((item, index) => {
      item.first = index === 0
    })
  }
  return groups
}
