import { useEffect, type ReactNode } from 'react'

export interface ModalProps {
  title: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  children?: ReactNode
  onConfirm(): void
  onCancel(): void
}

/** 通用弹窗：Esc 取消，Enter 确认（重命名输入框里也顺手）。 */
export function Modal({
  title,
  confirmLabel = '确定',
  cancelLabel = '取消',
  danger = false,
  children,
  onConfirm,
  onCancel
}: ModalProps): React.JSX.Element {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCancel()
      } else if (event.key === 'Enter') {
        event.preventDefault()
        onConfirm()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onConfirm, onCancel])

  return (
    <>
      <div className="modal-scrim" onClick={onCancel} />
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h3>{title}</h3>
        {children}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button className={danger ? 'btn danger' : 'btn primary'} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  )
}
