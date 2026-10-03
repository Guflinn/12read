import type { ReaderApi } from './index'

declare global {
  interface Window {
    reader: ReaderApi
  }
}

export {}
