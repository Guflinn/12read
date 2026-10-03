import { useEffect, useState } from 'react'

type Listener = (message: string) => void

let listener: Listener | null = null

/** 任何位置都能提示；Toast 未挂载时降级到 console，绝不抛错。 */
export function toast(message: string): void {
  if (listener) listener(message)
  else console.warn('[12read] ' + message)
}

const TOAST_MS = 2400

export function ToastHost(): React.JSX.Element {
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    listener = setMessage
    return () => {
      listener = null
    }
  }, [])

  useEffect(() => {
    if (message === null) return undefined
    const timer = setTimeout(() => setMessage(null), TOAST_MS)
    return () => clearTimeout(timer)
  }, [message])

  return (
    <div id="toast" className={message === null ? '' : 'on'} role="status">
      {message}
    </div>
  )
}
