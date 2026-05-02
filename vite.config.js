import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { resolve } from 'path';

export default defineConfig({  
  plugins: [
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    port:3517,
    allowedHosts: ["chunky-toaster.seagull-hippocampus.ts.net","broken-toaster.seagull-hippocampus.ts.net"],
    host:true,
    proxy: {
      '/queue-api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/queue-api/, '/api'),
      },
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html')
      },
    }
  }
});
