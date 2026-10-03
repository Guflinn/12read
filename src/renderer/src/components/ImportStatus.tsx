import type { ImportStage } from '@shared/types'
import { readerApi } from '@/core/api'
import { useLibraryStore } from '@/store/library'

const STAGE_LABELS: Record<ImportStage, string> = {
  reading: '读取文件',
  detecting: '检测编码',
  decoding: '解码',
  splitting: '切分章节',
  storing: '写入存储',
  done: '完成',
  error: '失败'
}

function baseName(filePath: string): string {
  const parts = filePath.split(/[\\/]/)
  return parts[parts.length - 1] || filePath
}

/** 导入进度 + 取消：大文件导入必须可中止（TECH.md 8.1）。 */
export function ImportStatus(): React.JSX.Element | null {
  const importing = useLibraryStore((s) => s.importing)
  if (importing.length === 0) return null

  return (
    <div className="import-status" id="import-status">
      {importing.map((progress) => (
        <div className="import-row" key={progress.taskId}>
          <div className="import-head">
            <span className="import-name" title={progress.filePath}>
              {baseName(progress.filePath)}
            </span>
            <span className="import-stage dim">
              {STAGE_LABELS[progress.stage]}
              {progress.message ? ' · ' + progress.message : ''}
            </span>
            <button
              className="btn ghost"
              onClick={() => {
                void readerApi().cancelTask(progress.taskId)
              }}
            >
              取消
            </button>
          </div>
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: Math.round(Math.min(1, Math.max(0, progress.ratio)) * 100) + '%' }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
