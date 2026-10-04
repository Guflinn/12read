import { useEffect, useRef, useState } from 'react'
import type { Chapter } from '@shared/types'
import { kindLabel } from '@/core/reading'
import { useReaderStore } from '@/store/reader'
import { Modal } from './Modal'
import { toast } from './Toast'

/** 目录抽屉：高亮当前节，点一条即跳转（章内偏移归零）；每行还能改名 / 合并。 */
export function TocDrawer(): React.JSX.Element {
  const chapters = useReaderStore((s) => s.chapters)
  const chapterIndex = useReaderStore((s) => s.chapterIndex)
  const open = useReaderStore((s) => s.tocOpen)
  const setToc = useReaderStore((s) => s.setToc)
  const goto = useReaderStore((s) => s.goto)
  const renameChapter = useReaderStore((s) => s.renameChapter)
  const mergeChapter = useReaderStore((s) => s.mergeChapter)
  const [renaming, setRenaming] = useState<Chapter | null>(null)
  const [renameText, setRenameText] = useState('')
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
          {/* 惰性渲染：抽屉关着时一条都不建，几千章的书也不拖慢阅读器挂载 */}
          {open
            ? chapters.map((chapter) => (
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
                  <span className="toc-label">
                    <span className="toc-kind">{kindLabel(chapter.kind)}</span>
                    {chapter.index + 1}. {chapter.title}
                  </span>
                  <span className="toc-edit">
                    <button
                      id={'toc-rename-' + chapter.index}
                      className="toc-btn"
                      title="改这一章的标题"
                      onClick={(event) => {
                        event.stopPropagation()
                        setRenaming(chapter)
                        setRenameText(chapter.title)
                      }}
                    >
                      改名
                    </button>
                    <button
                      id={'toc-merge-' + chapter.index}
                      className="toc-btn"
                      title="把下一章并进这一章"
                      disabled={chapter.index === chapters.length - 1}
                      onClick={(event) => {
                        event.stopPropagation()
                        void mergeChapter(chapter.index).then(() => toast('已合并到上一章'))
                      }}
                    >
                      合并
                    </button>
                  </span>
                </li>
              ))
            : null}
        </ol>
      </aside>

      {renaming ? (
        <Modal
          title="改章节标题"
          confirmLabel="保存"
          onCancel={() => setRenaming(null)}
          onConfirm={() => {
            const target = renaming
            const title = renameText.trim()
            setRenaming(null)
            if (!target || title.length === 0) return
            void renameChapter(target.index, title).then(() => toast('已改章节标题'))
          }}
        >
          <input
            id="toc-rename-input"
            autoFocus
            value={renameText}
            onChange={(event) => setRenameText(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
          />
        </Modal>
      ) : null}
    </>
  )
}
