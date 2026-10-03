import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { toast } from './components/Toast'
import { setReaderApi } from './core/api'
import './styles.css'

// 渲染进程唯一的对外通道（TECH.md 2.1 铁律 1）
setReaderApi(window.reader)

// 任何没被 catch 的异常都要看得见，不许白屏
window.addEventListener('error', (event) => {
  toast('脚本错误：' + (event.message || '未知错误'))
})
window.addEventListener('unhandledrejection', (event) => {
  toast('未处理的异常：' + String(event.reason))
})

const container = document.getElementById('root')
if (!container) throw new Error('缺少 #root 容器')

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
