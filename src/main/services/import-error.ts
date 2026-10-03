import type { ImportErrorCode } from '@shared/types'

/** 导入失败一律用这个错误类型，好让 IPC 层翻译成结构化结果（TECH.md 6.1 第 6 步）。 */
export class ImportError extends Error {
  readonly code: ImportErrorCode

  constructor(code: ImportErrorCode, message: string, override readonly cause?: unknown) {
    super(message)
    this.name = 'ImportError'
    this.code = code
  }
}

export function toImportError(cause: unknown, fallback: ImportErrorCode = 'unknown'): ImportError {
  if (cause instanceof ImportError) return cause
  const message = cause instanceof Error ? cause.message : String(cause)
  return new ImportError(fallback, message || '导入失败', cause)
}
