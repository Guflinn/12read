import { describe, expect, it } from 'vitest'
import { CH } from '@shared/channels'

describe('IPC 通道清单', () => {
  it('通道名唯一', () => {
    const names = Object.values(CH)
    expect(new Set(names).size).toBe(names.length)
  })

  it('通道名使用 domain:action 形式', () => {
    for (const name of Object.values(CH)) {
      expect(name).toMatch(/^[a-z]+:[a-z]+$/)
    }
  })

  it('TECH.md 4.1 列出的通道全部存在', () => {
    expect(Object.values(CH)).toEqual(
      expect.arrayContaining([
        'file:pick',
        'book:import',
        'book:list',
        'book:get',
        'book:rename',
        'book:delete',
        'book:chapters',
        'chapter:read',
        'progress:get',
        'progress:save',
        'task:cancel',
        'import:progress'
      ])
    )
  })
})
