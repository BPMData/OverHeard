import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const runtimeGroups = [
  {
    directory: 'ort',
    source: 'onnxruntime-web/dist',
    files: ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm'],
  },
  {
    directory: 'piper',
    source: '@diffusionstudio/piper-wasm/build',
    files: ['piper_phonemize.wasm', 'piper_phonemize.data'],
  },
  {
    directory: 'bergamot',
    source: '@browsermt/bergamot-translator/worker',
    files: ['translator-worker.js', 'bergamot-translator-worker.js', 'bergamot-translator-worker.wasm'],
  },
];

export function copyOfflineRuntimes(dist: string, modules: string) {
  for (const { directory, source, files } of runtimeGroups) {
    fs.mkdirSync(path.join(dist, directory), { recursive: true });
    for (const file of files) fs.copyFileSync(path.join(modules, source, file), path.join(dist, directory, file));
  }

  // ONNX uses our explicit /ort/ path. Drop the duplicate hashed WASM emitted by the bundler.
  const assets = path.join(dist, 'assets');
  for (const file of fs.readdirSync(assets)) {
    if (file.startsWith('ort-wasm')) fs.unlinkSync(path.join(assets, file));
  }
}

export function writeServiceWorker(dist: string) {
  const runtimes: Record<string, string> = {};
  for (const { directory, files } of runtimeGroups) {
    for (const file of files) {
      const url = '/' + directory + '/' + file;
      const bytes = fs.readFileSync(path.join(dist, directory, file));
      if (!bytes.length || (file.endsWith('.wasm') && !bytes.subarray(0, 4).equals(Buffer.from([0, 97, 115, 109])))) {
        throw new Error('Invalid offline runtime: ' + url);
      }
      runtimes[url] = 'sha256-' + createHash('sha256').update(bytes).digest('base64');
    }
  }

  const precache: string[] = [];
  function collect(directory: string) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      const url = '/' + path.relative(dist, file).split(path.sep).join('/');
      if (entry.isDirectory()) collect(file);
      else if (!(url in runtimes) && url !== '/sw.js' && !url.endsWith('.map') && !url.startsWith('/assets/aistudio/'))
        precache.push(url);
    }
  }
  collect(dist);
  const shell = createHash('sha256');
  for (const url of precache.sort()) {
    shell.update(url);
    shell.update(fs.readFileSync(path.join(dist, url)));
  }

  const template = fs.readFileSync(path.join(dist, 'sw.js'), 'utf8');
  const placeholder = "const BUILD = { version: 'dev', precache: [], runtimes: {} };";
  if (!template.includes(placeholder)) throw new Error('Missing build manifest placeholder in sw.js');
  const manifest = { version: shell.digest('hex').slice(0, 12), precache, runtimes };
  fs.writeFileSync(
    path.join(dist, 'sw.js'),
    template.replace(placeholder, () => 'const BUILD = ' + JSON.stringify(manifest) + ';')
  );
}
