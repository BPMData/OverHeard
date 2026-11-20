import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import crypto from 'node:crypto';
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

// Directories the service worker saves on first use instead of at install: the Piper
// runtimes are ~40 MB, too much to push to every student who opens a room link.
const NOT_PRECACHED = ['ort/', 'piper/', 'assets/aistudio/'];

/**
 * Fill in the service worker's install-time file list and version, so one online visit saves
 * the whole app for offline use and each deploy replaces the previous copy.
 */
function writeServiceWorkerPrecache() {
  const distDir = path.resolve(__dirname, 'dist');
  const swPath = path.join(distDir, 'sw.js');
  if (!fs.existsSync(swPath)) return;

  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(path.relative(distDir, full).split(path.sep).join('/'));
    }
  };
  walk(distDir);

  const precache = files
    .filter((file) => file !== 'sw.js' && !file.endsWith('.map'))
    .filter((file) => !NOT_PRECACHED.some((prefix) => file.startsWith(prefix)))
    .sort();
  const hash = crypto.createHash('sha256');
  for (const file of precache) {
    hash.update(file);
    hash.update(fs.readFileSync(path.join(distDir, file)));
  }
  const version = hash.digest('hex').slice(0, 12);

  const source = fs.readFileSync(swPath, 'utf8');
  const filled = source
    .replace('const PRECACHE = [];', `const PRECACHE = ${JSON.stringify(precache.map((f) => `/${f}`))};`)
    .replace("const SHELL_VERSION = 'dev';", `const SHELL_VERSION = '${version}';`);
  if (filled === source) throw new Error('sw.js placeholders not found; precache list not written');
  fs.writeFileSync(swPath, filled);
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
          writeServiceWorkerPrecache();
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
