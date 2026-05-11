import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      external: [
        // Capacitor 包在 web build 里不打包：
        // native.js 用 top-level dynamic import + window.Capacitor 检测，
        // 只在 iOS 原生壳里才会实际 import 这些模块。
        /^@capacitor(\/|$)/,
        /^@capacitor-community(\/|$)/,
      ],
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      // dev 时将 /api/parse 代理到本地 wrangler dev 实例
      // 先跑 `npm run dev` in worker/，再跑 `vite dev` in 根目录
      '/api/parse': {
        target: 'http://localhost:8787',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/parse/, '/parse'),
      },
    },
  },
});
