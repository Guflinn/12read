import { useEffect, useState } from 'react'
import type { AppInfo } from '../../preload/index'

export default function App(): React.JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    window.reader
      .appInfo()
      .then((v) => {
        if (alive) setInfo(v)
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="boot">
      <div className="boot-card">
        <div className="logo">十二</div>
        <h1>十二阅读</h1>
        <p className="dim">本地优先的 TXT 桌面阅读器</p>
        {error ? <p className="err">初始化失败：{error}</p> : null}
        {info ? (
          <ul className="boot-meta">
            <li>版本 {info.version}</li>
            <li>Electron {info.electron}</li>
            <li>Chromium {info.chrome}</li>
            <li>Node {info.node}</li>
            <li>平台 {info.platform}</li>
          </ul>
        ) : (
          <p className="dim">正在初始化…</p>
        )}
      </div>
    </div>
  )
}
