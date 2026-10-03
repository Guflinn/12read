import { parentPort, workerData } from 'node:worker_threads'
import type { ImportErrorCode } from '@shared/types'
import { toImportError } from '../services/import-error'
import { runDecodeJob, type DecodeJob } from './decode-job'

/** worker 只负责把执行体的结果转成消息，逻辑都在 decode-job 里（可单测、可兜底内联）。 */
export type WorkerMessage =
  | { type: 'progress'; stage: string; ratio: number; message?: string }
  | { type: 'done'; result: unknown }
  | { type: 'error'; code: ImportErrorCode; message: string }

const port = parentPort
const job = workerData as DecodeJob

if (port) {
  void runDecodeJob(job, (stage, ratio, message) => {
    port.postMessage({ type: 'progress', stage, ratio, message } satisfies WorkerMessage)
  })
    .then((result) => {
      port.postMessage({ type: 'done', result } satisfies WorkerMessage)
    })
    .catch((cause: unknown) => {
      const error = toImportError(cause)
      port.postMessage({ type: 'error', code: error.code, message: error.message } satisfies WorkerMessage)
    })
}
