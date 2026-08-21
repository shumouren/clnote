import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 开发服务器绑定 host，便于 WorkBuddy 预览面板 / 同网设备访问
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    strictPort: false,
    hmr: {
      // 关闭错误覆盖层：epub 书内畸形资源 URL（res:// 等）请求偶发会让 Vite 报
      // URI malformed 并弹全屏错误层；内容本身不受影响，关掉后不打扰阅读。
      overlay: false,
    },
  },
  // 为将来打包成 Tauri 应用做准备：资源用相对路径
  base: './',
  build: {
    // 本机 safe-delete 沙箱会拦截 Vite 对 dist 的清理（trash 失败导致构建中断），
    // 关闭自动清空，改为需要时手动清理 dist 目录。
    emptyOutDir: false,
  },
})
