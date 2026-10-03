import { useEffect, useRef } from 'react'
import { kindLabel } from '@/core/reading'
import { useReaderStore } from '@/store/reader'

/** 目录抽屉：高亮当前节，点一条即跳转（章内偏移归零）。 */
export function TocDrawer(): React.JSX.Element {
  const chapters = useReaderStore((s) => s.chapters)
  const chapterIndex = useReaderStore((s) => s.chapterIndex)
  const open = useReaderStore((s) => s.tocOpen)
  const setToc = useReaderStore((s) => s.setToc)
  const goto = useReaderStore((s) => s.goto)
  const activeRef = useRef<HTMLLIElement | null>(null)

  useEffect(() => {
    if (!open) return
    activeRef.current?.scrollIntoView({ block: 'center' })
  }, [open, chapterIndex])

  return (
    <>
      <div className={open ? 'scrim on' : 'scrim'} onClick={() => setToc(false)} />
      <aside className={open ? 'drawer on' : 'drawer'} id="toc-drawer" aria-hidden={!open}>
        <div className="drawer-head">
          <span>目录</span>
          <span className="grow dim">{chapters.length} 节</span>
          <button className="icon-btn" aria-label="关闭目录" onClick={() => setToc(false)}>
            ×
          </button>
        </div>
        <ol className="toc-list" id="toc-list">
          {chapters.map((chapter) => (
            <li
              key={chapter.index}
              className={chapter.index === chapterIndex ? 'on' : ''}
              ref={chapter.index === chapterIndex ? activeRef : null}
              title={chapter.title}
              onClick={() => {
                setToc(false)
                void goto(chapter.index, 0)
              }}
            >
              <span className="toc-kind">{kindLabel(chapter.kind)}</span>
              {chapter.index + 1}. {chapter.title}
            </li>
          ))}
        </ol>
      </aside>
    </>
  )
}
