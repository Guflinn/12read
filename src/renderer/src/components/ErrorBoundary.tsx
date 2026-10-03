import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  message: string | null
}

/** 渲染异常兜底：不许白屏，给一条能回到书架的路。 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { message: null }

  static getDerivedStateFromError(error: unknown): State {
    return { message: error instanceof Error ? error.message : String(error) }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[12read] 渲染异常', error, info.componentStack)
  }

  override render(): ReactNode {
    if (this.state.message !== null) {
      return (
        <div className="boot">
          <div className="boot-card">
            <div className="logo">十二</div>
            <h1>界面出错了</h1>
            <p className="dim">这不是致命错误，回到书架通常可以继续阅读。</p>
            <p className="err">{this.state.message}</p>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => this.setState({ message: null })}>
                重试
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  window.location.hash = '#/shelf'
                  this.setState({ message: null })
                }}
              >
                回到书架
              </button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
