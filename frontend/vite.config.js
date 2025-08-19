import { defineConfig } from 'vite'
import { resolve } from 'node:path'

// 以 frontend/public 作为入口（包含 index.html）
export default defineConfig({
  root: resolve(__dirname, 'public'),
  base: '/',
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      // 保持 config.js 作为外部运行时文件：通过将其视为静态资源复制，而非打包依赖
      // 我们会直接在 index.html 中以普通 <script src="./config.js"> 引用它
      input: resolve(__dirname, 'public/index.html')
    }
  },
  server: {
    port: 5173
  },
  preview: {
    outDir: resolve(__dirname, 'dist')
  }
})