import { useCallback, useEffect, useState } from 'react'
import { ErrorBar } from './components/ErrorBar'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ReaderView } from './components/ReaderView'
import { ShelfView } from './components/ShelfView'
import { ToastHost } from './components/Toast'
import { readerApi } from './core/api'
import { setDeviceId } from './core/session'
import { useLibraryStore } from './store/library'
import { useReaderStore } from './store/reader'
import { useSettingsStore } from './store/settings'

type Route = { name: 'shelf' } | { name: 'reader'; bookId: string }

const BOOK_ID_IN_HASH = /^#\/read\/([0-9a-fA-F-]{36})$/

/** 路由就是 hash：#/shelf 与 #/read/<bookId>，和原型保持一致。 */
function parseHash(hash: string): Route {
  const match = BOOK_ID_IN_HASH.exec(hash)
  const bookId = match ? match[1] : null
  return bookId ? { name: 'reader', bookId } : { name: 'shelf' }
}

export default function App(): React.JSX.Element {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash))
  const [ready, setReady] = useState(false)
  const settings = useSettingsStore((s) => s.settings)

  // 启动：读设备 id / 设置 / 书架，并订阅导入进度
  useEffect(() => {
    let alive = true
    const api = readerApi()
    const bootstrap = async (): Promise<void> => {
      try {
        const info = await api.appInfo()
        if (alive) setDeviceId(info.deviceId)
      } catch (cause) {
        console.error('[12read] 读取运行信息失败', cause)
      }
      try {
        await Promise.all([useSettingsStore.getState().load(), useLibraryStore.getState().load()])
      } catch (cause) {
        console.error('[12read] 初始化失败', cause)
      }
      if (alive) setReady(true)
    }
    void bootstrap()
    const unsubscribe = api.onImportProgress((progress) => {
      useLibraryStore.getState().applyProgress(progress)
      if (progress.stage === 'done') void useLibraryStore.getState().load()
    })
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    const onHashChange = (): void => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  // 进阅读器就换书；回书架就写回进度并刷新书架（最近阅读排序）
  useEffect(() => {
    if (route.name === 'reader') void useReaderStore.getState().open(route.bookId)
    else {
      useReaderStore.getState().leave()
      void useLibraryStore.getState().load()
    }
    return undefined
  }, [route])

  // 切后台 / 失焦 / 关窗前强制落一次进度（TECH.md 6.3）
  useEffect(() => {
    const flush = (): void => useReaderStore.getState().flush()
    window.addEventListener('visibilitychange', flush)
    window.addEventListener('blur', flush)
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('visibilitychange', flush)
      window.removeEventListener('blur', flush)
      window.removeEventListener('beforeunload', flush)
    }
  }, [])

  const openBook = useCallback((bookId: string): void => {
    window.location.hash = '#/read/' + bookId
  }, [])

  const backToShelf = useCallback((): void => {
    window.location.hash = '#/shelf'
  }, [])

  if (!ready) {
    return (
      <div className="app" data-theme={settings.theme}>
        <div className="boot">
          <div className="boot-card">
            <div className="logo">十二</div>
            <h1>十二阅读</h1>
            <p className="dim">正在初始化…</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <ErrorBoundary>
      <div
        className="app"
        data-theme={settings.theme}
        style={
          {
            '--fs': settings.fontSize + 'px',
            '--lh': String(settings.lineHeight)
          } as React.CSSProperties
        }
      >
        <ErrorBar />
        {route.name === 'reader' ? (
          <ReaderView onBack={backToShelf} />
        ) : (
          <ShelfView onOpen={openBook} />
        )}
        <ToastHost />
      </div>
    </ErrorBoundary>
  )
}
