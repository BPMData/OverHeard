import { INFERENCE_PROGRESS_URL, PATH_MAP, TtsSession, remove, type Progress } from '@mintplex-labs/piper-tts-web';
import { PIPER_VOICES } from './voices';

const PIPER_WASM_PATHS = {
  onnxWasm: {
    mjs: '/ort/ort-wasm-simd-threaded.jsep.mjs',
    wasm: '/ort/ort-wasm-simd-threaded.jsep.wasm',
  } as unknown as string,
  piperWasm: '/piper/piper_phonemize.wasm',
  piperData: '/piper/piper_phonemize.data',
};

const MAX_CACHED_SESSIONS = 2;

for (const voice of PIPER_VOICES) {
  const map = PATH_MAP as Record<string, string>;
  if (voice.useRhasspyRepo) {
    map[voice.modelId] = `../../../../rhasspy/piper-voices/resolve/main/${voice.hfPath}`;
  } else if (!(voice.modelId in map)) {
    map[voice.modelId] = voice.hfPath;
  }
}

type IncomingMessage =
  | { type: 'preload'; modelId: string }
  | { type: 'cancelJob'; jobId: number }
  | { type: 'synthesize'; jobId: number; modelId: string; speakerId: number; text: string };

const workerScope = self as unknown as {
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
  addEventListener: (
    type: 'message',
    listener: (event: MessageEvent<IncomingMessage>) => void,
  ) => void;
};

const sessionCache = new Map<string, TtsSession>();
// Models that have already synthesized once in this worker. The first synthesis also starts
// the phonemizer and runs the slowest inference, so a preload does it ahead of real speech.
const warmedModels = new Set<string>();
const cancelledJobs = new Set<number>();
let ortPatched = false;
let activeSpeakerId = 0;
let queue: Promise<void> = Promise.resolve();

function runSerialized(task: () => Promise<void>): void {
  queue = queue.then(task, task);
}

async function installSpeakerInterceptor(): Promise<void> {
  if (ortPatched) return;
  ortPatched = true;
  const ortModule = await import('onnxruntime-web/wasm');
  const ort = ortModule.default ?? ortModule;

  const origCreate = ort.InferenceSession.create.bind(ort.InferenceSession);
  ort.InferenceSession.create = async (...args: unknown[]) => {
    const session = await origCreate(...args);
    const origRun = session.run.bind(session);
    session.run = (feeds: Record<string, unknown>, ...rest: unknown[]) => {
      if (feeds && 'sid' in feeds && feeds.sid) {
        feeds.sid = new ort.Tensor('int64', [activeSpeakerId]);
      }
      return origRun(feeds, ...rest);
    };
    return session;
  };
}

function isValidWav(buffer: ArrayBuffer): boolean {
  if (!buffer || buffer.byteLength <= 44) return false;
  const view = new DataView(buffer);
  return view.getUint32(0, false) === 0x52494646 && view.getUint32(8, false) === 0x57415645;
}

async function verifyOpfs(): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.storage || typeof navigator.storage.getDirectory !== 'function') {
    throw new Error('OPFS storage unavailable');
  }
  await navigator.storage.getDirectory();
}

async function ensureSession(modelId: string): Promise<TtsSession> {
  const cached = sessionCache.get(modelId);
  if (cached) {
    sessionCache.delete(modelId);
    sessionCache.set(modelId, cached);
    return cached;
  }

  await verifyOpfs();
  await installSpeakerInterceptor();

  if (sessionCache.size >= MAX_CACHED_SESSIONS) {
    const oldest = sessionCache.keys().next().value;
    if (oldest) sessionCache.delete(oldest);
  }

  (TtsSession as unknown as { _instance: TtsSession | null })._instance = null;
  workerScope.postMessage({ type: 'status', modelId, status: 'downloading', progress: 0 });

  let loading = true;
  let lastReported = 0;

  try {
    const session = await TtsSession.create({
      voiceId: modelId,
      wasmPaths: PIPER_WASM_PATHS,
      progress: (event: Progress) => {
        if (!loading || event.url === INFERENCE_PROGRESS_URL) return;
        if (typeof event.loaded === 'number' && typeof event.total === 'number' && event.total > 0) {
          const pct = Math.min(99, Math.max(0, Math.round((event.loaded / event.total) * 100)));
          if (pct > lastReported) {
            lastReported = pct;
            workerScope.postMessage({
              type: 'status',
              modelId,
              status: 'downloading',
              progress: pct,
            });
          }
        }
      },
    });
    loading = false;
    sessionCache.set(modelId, session);
    workerScope.postMessage({ type: 'status', modelId, status: 'ready', progress: 100 });
    return session;
  } catch (error) {
    loading = false;
    (TtsSession as unknown as { _instance: TtsSession | null })._instance = null;
    sessionCache.delete(modelId);
    await remove(modelId).catch(() => undefined);
    const message = error instanceof Error ? error.message : 'Failed to load Piper voice';
    workerScope.postMessage({ type: 'status', modelId, status: 'error', error: message });
    throw error;
  }
}

workerScope.addEventListener('message', (event: MessageEvent<IncomingMessage>) => {
  const data = event.data;
  if (!data) return;

  if (data.type === 'cancelJob') {
    cancelledJobs.add(data.jobId);
    if (cancelledJobs.size > 300) {
      const oldest = cancelledJobs.values().next().value;
      if (typeof oldest === 'number') cancelledJobs.delete(oldest);
    }
    return;
  }

  if (data.type === 'preload') {
    runSerialized(async () => {
      try {
        const session = await ensureSession(data.modelId);
        if (!warmedModels.has(data.modelId)) {
          warmedModels.add(data.modelId);
          await session.predict('Hello.').catch(() => undefined);
        }
      } catch {
        // Status error already posted by ensureSession.
      }
    });
    return;
  }

  if (data.type === 'synthesize') {
    runSerialized(async () => {
      if (cancelledJobs.has(data.jobId)) return;
      try {
        const session = await ensureSession(data.modelId);
        if (cancelledJobs.has(data.jobId)) return;
        activeSpeakerId = data.speakerId;
        const wavBlob = await session.predict(data.text);
        if (cancelledJobs.has(data.jobId)) return;
        const wavBuffer = await wavBlob.arrayBuffer();
        if (!isValidWav(wavBuffer)) {
          throw new Error('Piper returned empty or invalid audio');
        }
        workerScope.postMessage({ type: 'wav', jobId: data.jobId, wavBuffer }, [wavBuffer]);
      } catch (error) {
        if (cancelledJobs.has(data.jobId)) return;
        const message = error instanceof Error ? error.message : 'Piper synthesis failed';
        workerScope.postMessage({ type: 'error', jobId: data.jobId, error: message });
      }
    });
  }
});
