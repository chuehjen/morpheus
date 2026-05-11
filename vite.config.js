import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiKey = env.VITE_LONGCAT_KEY || '';

  return defineConfig({
    base: './',
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
    server: {
      host: true,
      port: 5173,
      proxy: {
        '/api/longcat': {
          target: 'https://api.longcat.chat',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/longcat/, ''),
          headers: {
            'Authorization': `Bearer ${apiKey}`,
          },
        },
      },
    },
  });
});
