import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'path';
import {defineConfig} from 'vite';

function copyPiperRuntimesToDist() {
  const ortSrcDir = path.resolve(__dirname, 'node_modules/onnxruntime-web/dist');
  const piperSrcDir = path.resolve(__dirname, 'node_modules/@diffusionstudio/piper-wasm/build');
  const distDir = path.resolve(__dirname, 'dist');
  const ortDestDir = path.join(distDir, 'ort');
  const piperDestDir = path.join(distDir, 'piper');
  const assetsDir = path.join(distDir, 'assets');

  if (fs.existsSync(ortSrcDir)) {
    fs.mkdirSync(ortDestDir, {recursive: true});
    for (const file of [
      'ort-wasm-simd-threaded.jsep.mjs',
      'ort-wasm-simd-threaded.jsep.wasm',
    ]) {
      const src = path.join(ortSrcDir, file);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(ortDestDir, file));
      }
    }
  }

  if (fs.existsSync(piperSrcDir)) {
    fs.mkdirSync(piperDestDir, {recursive: true});
    for (const file of ['piper_phonemize.wasm', 'piper_phonemize.data']) {
      const src = path.join(piperSrcDir, file);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(piperDestDir, file));
      }
    }
  }

  if (fs.existsSync(assetsDir)) {
    for (const file of fs.readdirSync(assetsDir)) {
      if (file.startsWith('ort-wasm')) {
        fs.rmSync(path.join(assetsDir, file), {force: true});
      }
    }
  }
}

export default defineConfig(() => {
  return {
    worker: {
      format: 'es' as const,
    },
    plugins: [
      {
        name: 'overheard-piper-runtimes',
        closeBundle() {
          copyPiperRuntimesToDist();
        },
      },
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
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
