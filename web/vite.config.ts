import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5174,
    proxy: {
      '/api': 'http://localhost:3000',
      '/healthz': 'http://localhost:3000',
    },
    // 首屏进入时若还有依赖没预打包，Vite 会即时重优化，重优化期间在途的模块请求
    // 会拿到 504/JSON → 浏览器报 "MIME type application/json" → 整页白屏。
    // e2e 里首次 goto 常撞上这个 race。预热主入口，让依赖在启动阶段就打包完。
    warmup: {
      clientFiles: ['./src/main.tsx'],
    },
  },
  // 显式声明所有运行时依赖，启动即预打包，避免 e2e 首次导航触发即时重优化白屏。
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-dev-runtime',
      'react/jsx-runtime',
      'react-router-dom',
      '@tanstack/react-query',
      'axios',
      'lucide-react',
      'react-markdown',
      'remark-gfm',
    ],
  },
})
