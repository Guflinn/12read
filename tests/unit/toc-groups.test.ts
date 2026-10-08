import { describe, expect, it } from 'vitest'
import { groupChapters } from '@/core/toc-groups'
import type { Chapter } from '@shared/types'

/**
 * 目录分组（0.2.0）：章节表是平的，「哪一章属于哪本书」靠 groupTitle，
 * 三级目录里最深那层（节）靠 parentTitle 认出来。
 *
 * 用户 2026-10-08 的明确要求（对着 iPhone 自带图书提的）：
 * - 每本书是**一个一级分类**，书下面再分「第几章」「第几节」
 * - 目录里**不要再有小序号**（「1. 开篇」那种）
 */
function chapter(
  title: string,
  groupTitle: string | null = null,
  parentTitle: string | null = null
): Chapter {
  return {
    bookId: 'book',
    index: 0,
    title,
    groupTitle,
    parentTitle,
    startOffset: 0,
    charLength: 1,
    kind: 'chapter'
  }
}

describe('groupChapters', () => {
  it('没有 groupTitle 的书：一整组、没有分类行，界面与以前一模一样', () => {
    const groups = groupChapters([chapter('第一章'), chapter('第二章')])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.title).toBeNull()
    expect(groups[0]?.headerJump).toBeNull()
    expect(groups[0]?.items.map((item) => item.chapter.title)).toEqual(['第一章', '第二章'])
    expect(groups[0]?.items.every((item) => item.section)).toBe(false)
  })

  it('合集：按册切组，每册给一个可点的分类行（跳到该册首页）', () => {
    const groups = groupChapters([
      chapter('封面'),
      chapter('红高粱家族', '红高粱家族', '红高粱家族'),
      chapter('第一章 红高粱', '红高粱家族', '红高粱家族'),
      chapter('天堂蒜薹之歌', '天堂蒜薹之歌', '天堂蒜薹之歌')
    ])
    expect(groups.map((group) => group.title)).toEqual([null, '红高粱家族', '天堂蒜薹之歌'])
    // 第一组的「封面」没有分组
    expect(groups[0]?.items.map((item) => item.chapter.title)).toEqual(['封面'])
    // 册名与组内第一项同名 → 不再重复列出，点分类行就等于点它
    expect(groups[1]?.headerJump).toBe(1)
    expect(groups[1]?.items.map((item) => item.chapter.title)).toEqual(['第一章 红高粱'])
    expect(groups[2]?.headerJump).toBe(3)
    expect(groups[2]?.items).toEqual([])
  })

  it('册名与组内第一项不同名时，第一项照常列出（分类行仍可点）', () => {
    const groups = groupChapters([
      chapter('卷首语', '红高粱家族', '红高粱家族'),
      chapter('第一章', '红高粱家族', '红高粱家族')
    ])
    expect(groups[0]?.headerJump).toBe(0)
    expect(groups[0]?.items.map((item) => item.chapter.title)).toEqual(['卷首语', '第一章'])
  })

  it('标出「节」：父级不是本册的那一层缩进显示', () => {
    const groups = groupChapters([
      chapter('第一章 红高粱', '红高粱家族', '红高粱家族'),
      chapter('一', '红高粱家族', '第一章 红高粱'),
      chapter('二', '红高粱家族', '第一章 红高粱'),
      chapter('第二章 高粱酒', '红高粱家族', '红高粱家族')
    ])
    expect(groups[0]?.items.map((item) => [item.chapter.title, item.section])).toEqual([
      ['第一章 红高粱', false],
      ['一', true],
      ['二', true],
      ['第二章 高粱酒', false]
    ])
  })

  it('空章节表给空数组', () => {
    expect(groupChapters([])).toEqual([])
  })
})
