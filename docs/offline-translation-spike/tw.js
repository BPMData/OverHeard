// Transformers.js worker: loads a seq2seq model, translates sentences, reports timings.
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/dist/transformers.min.js';
env.allowLocalModels = true; env.localModelPath = '/models/'; env.useBrowserCache = true;
let tr = null, cfg = null;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') {
      cfg = data; const local = data.model.startsWith('local:');
      env.allowRemoteModels = !local;
      if (data.threads) env.backends.onnx.wasm.numThreads = data.threads;
      const t0 = performance.now();
      tr = await pipeline('translation', local ? data.model.slice(6) : data.model, { device: data.device, dtype: data.dtype,
        progress_callback: p => { if (p.status === 'progress' && p.file) self.postMessage({ type: 'progress', file: p.file, loaded: p.loaded, total: p.total }); } });
      self.postMessage({ type: 'loaded', ms: performance.now() - t0 });
    } else if (data.type === 'translate') {
      const t0 = performance.now();
      const out = await tr(data.text, data.opts || {});
      self.postMessage({ type: 'result', id: data.id, text: out[0].translation_text, ms: performance.now() - t0 });
    }
  } catch (e) { self.postMessage({ type: 'error', error: String(e && e.stack || e) }); }
};
