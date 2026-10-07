import { describe, expect, it } from 'vitest'
import { groupChapters } from '@/core/toc-groups'
import type { Chapter } from '@shared/types'

/**
 * 目录分组（0.2.0）：章节表是平的，「哪一章属于哪本书」靠 groupTitle。
 * 这里守住三件事：普通书零分组（界面与以前完全一致）、合集按卷切、组名与首页同名不重复画。
 */
function chapter(title: string, groupTitle: string | null = null): Chapter {
  return {
    bookId: 'book',
    index: 0,
    title,
    groupTitle,
    startOffset: 0,
    charLength: 1,
    kind: 'chapter'
  }
}

describe('groupChapters', () => {
  it('没有 groupTitle 的书：一整组、无组名，界面与以前一模一样', () => {
    const groups = groupChapters([chapter('第一章'), chapter('第二章')])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.title).toBeNull()
    expect(groups[0]?.showHeader).toBe(false)
    expect(groups[0]?.items.map((item) => item.chapter.title)).toEqual(['第一章', '第二章'])
  })

  it('合集：按卷切组，保留原顺序与原始下标（下标用来渲染与跳转）', () => {
    const groups = groupChapters([
      chapter('开篇'),
      chapter('红高粱家族', '红高粱家族'),
      chapter('第一章 红高粱', '红高粱家族'),
      chapter('天堂蒜薹之歌', '天堂蒜薹之歌'),
      chapter('第一章 蒜薹', '天堂蒜薹之歌')
    ])
    expect(groups.map((group) => group.title)).toEqual([null, '红高粱家族', '天堂蒜薹之歌'])
    expect(groups[1]?.items.map((item) => item.index)).toEqual([1, 2])
    expect(groups[2]?.items.map((item) => item.index)).toEqual([3, 4])
  })

  it('组内首项标题等于组名时不再单画组名（避免「天堂蒜薹之歌 / 天堂蒜薹之歌」重复）', () => {
    const withSameTitle = groupChapters([chapter('天堂蒜薹之歌', '天堂蒜薹之歌'), chapter('第一章', '天堂蒜薹之歌')])
    expect(withSameTitle[0]?.showHeader).toBe(false)

    const withDifferentTitle = groupChapters([chapter('卷首语', '天堂蒜薹之歌'), chapter('第一章', '天堂蒜薹之歌')])
    expect(withDifferentTitle[0]?.showHeader).toBe(true)
  })

  it('每组首项带 first 标记：界面靠它画「册首」，不画组名时也能看出书界', () => {
    const groups = groupChapters([
      chapter('开篇'),
      chapter('甲集', '甲集'),
      chapter('第一章', '甲集'),
      chapter('乙集', '乙集')
    ])
    expect(groups[0]?.items.map((item) => item.first)).toEqual([true])
    expect(groups[1]?.items.map((item) => item.first)).toEqual([true, false])
    expect(groups[2]?.items.map((item) => item.first)).toEqual([true])
  })

  it('空章节表给空数组', () => {
    expect(groupChapters([])).toEqual([])
  })
})
