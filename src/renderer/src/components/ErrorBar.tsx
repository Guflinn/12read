import { useLibraryStore } from '@/store/library'
import { useReaderStore } from '@/store/reader'

/** 失败必须看得见（TECH.md 8.3）；这里不吞异常，只负责显示和关闭。 */
export function ErrorBar(): React.JSX.Element | null {
  const libraryError = useLibraryStore((s) => s.error)
  const readerError = useReaderStore((s) => s.error)
  const message = readerError ?? libraryError

  if (!message) return null

  return (
    <div id="errbar" style={{ display: 'flex' }}>
      <span className="err-text">{message}</span>
      <button
        className="err-close"
        aria-label="关闭错误提示"
        onClick={() => {
          useLibraryStore.getState().clearError()
          useReaderStore.setState({ error: null })
        }}
      >
        ×
      </button>
    </div>
  )
}
