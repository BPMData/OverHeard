import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { copyOfflineRuntimes, writeServiceWorker } from './scripts/build-offline.ts';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    worker: {
      format: 'es' as const,
    },
    plugins: [
      {
        name: 'overheard-piper-runtimes',
        closeBundle() {
          const dist = path.join(import.meta.dirname, 'dist');
          copyOfflineRuntimes(dist, path.join(import.meta.dirname, 'node_modules'));
          writeServiceWorker(dist);
        },
      },
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        '@': import.meta.dirname,
      },
    },
    server: {
      // HMR can be disabled via the DISABLE_HMR env var (left over from the AI Studio template).
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
