// Runs an Opus-MT model (Swahili) with Transformers.js on single-thread WebAssembly.
// Its files come only from the saved-model cache (store.ts), never the network, so it works
// offline once the model is saved. Messages: {id, type: 'load', lang} and {id, type: 'translate', text}.
import { env, pipeline } from '@huggingface/transformers';
import { bergamotModelFor, maxNewTokens, modelFileUrl, type BergamotModel } from './models';
import { BERGAMOT_CACHE_NAME } from './store';

type Incoming = { id: number; type: 'load'; lang: string } | { id: number; type: 'translate'; text: string };

type Translate = (text: string, options?: Record<string, unknown>) => Promise<unknown>;

const scope = self as unknown as {
  postMessage: (message: unknown) => void;
  addEventListener: (type: 'message', listener: (event: MessageEvent<Incoming>) => void) => void;
};

let translator: Translate | null = null;
let loaded: BergamotModel | null = null;
// One sentence at a time: the ONNX sessions aren't safe to run concurrently
let queue: Promise<unknown> = Promise.resolve();

function configure(model: BergamotModel) {
  const folder = model.files[0].path.split('/')[0];
  env.allowLocalModels = false;
  env.allowRemoteModels = true; // Transformers.js insists on one source; the cache below always answers
  env.useBrowserCache = false;
  env.useCustomCache = true;
  env.remoteHost = `${model.baseUrl}/`;
  env.remotePathTemplate = '{model}/';
  env.customCache = {
    // Transformers.js asks by URL (or by local path first); map either to the saved file.
    match: async (key: string | Request) => {
      const url = typeof key === 'string' ? key : key.url;
      const at = url.lastIndexOf(`${folder}/`);
      if (at < 0) return undefined;
      const file = model.files.find((f) => f.path === url.slice(at));
      if (!file) return undefined;
      const cache = await caches.open(BERGAMOT_CACHE_NAME);
      return (await cache.match(modelFileUrl(model, file))) ?? undefined;
    },
    put: async () => {},
  } as unknown as typeof env.customCache;
  const wasm = env.backends.onnx.wasm as { numThreads?: number; wasmPaths?: unknown; proxy?: boolean };
  // The ONNX Runtime files the voice engine already serves (and the service worker saves)
  wasm.wasmPaths = { mjs: '/ort/ort-wasm-simd-threaded.jsep.mjs', wasm: '/ort/ort-wasm-simd-threaded.jsep.wasm' };
  // The app isn't cross-origin isolated, and one thread was faster in the spike anyway
  wasm.numThreads = 1;
  wasm.proxy = false;
}

async function load(lang: string) {
  const model = bergamotModelFor(lang);
  if (!model || model.engine !== 'opus') throw new Error(`No Opus-MT model for ${lang}`);
  if (loaded === model && translator) return;
  configure(model);
  translator = (await pipeline('translation', model.files[0].path.split('/')[0], {
    device: 'wasm',
    dtype: 'q8',
  })) as unknown as Translate;
  loaded = model;
}

async function translate(text: string): Promise<string> {
  if (!translator) throw new Error('Translation model not loaded');
  const output = (await translator(text, { max_new_tokens: maxNewTokens(text) })) as Array<{
    translation_text?: string;
  }>;
  return output?.[0]?.translation_text ?? '';
}

scope.addEventListener('message', ({ data }) => {
  const work: () => Promise<unknown> =
    data.type === 'load' ? () => load(data.lang).then(() => true) : () => translate(data.text);
  const run = queue.then(work, work);
  queue = run.catch(() => undefined);
  run.then(
    (result) => scope.postMessage({ id: data.id, result }),
    (error: unknown) =>
      scope.postMessage({ id: data.id, error: { message: error instanceof Error ? error.message : String(error) } })
  );
});
