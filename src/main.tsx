import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/global.css'

// 注意：这里不包 React.StrictMode，避免开发模式下 effect 双调用
// 导致 TipTap 编辑器重复初始化。
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<App />)
