import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        watch: {
          ignored: [
            '**/node_modules/**',
            '**/dist/**',
            '**/.git/**',
            '**/__smoke__/**',
            '**/*.tmpdir/**',
          ],
        },
        // 本机 OpenAI 兼容网关（不回 CORS 头），走同源代理
        proxy: {
          '/v1': {
            target: 'http://127.0.0.1:4110',
            changeOrigin: true,
          },
        },
      },
      preview: {
        port: 3100,
        host: '0.0.0.0',
        proxy: {
          '/v1': {
            target: 'http://127.0.0.1:4110',
            changeOrigin: true,
          },
        },
      },
      plugins: [react()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      test: {
        globals: true,
        environment: 'node',
        setupFiles: [],
      }
    };
});
