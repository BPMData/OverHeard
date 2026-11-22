import { INFERENCE_PROGRESS_URL, PATH_MAP, TtsSession, remove, stored, type Progress } from '@mintplex-labs/piper-tts-web';
import { boostQuietWav } from './loudness';
import { pinyinPhonemeIds, splitChineseForSpeech } from './pinyin';
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
  | { type: 'save'; requestId: number; modelId: string }
  | { type: 'listStored'; requestId: number }
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
// Failed loads of a voice that was already saved on this device. A saved voice is only deleted
// after it fails twice: one failure is usually the environment (offline, low memory), not the file.
const savedLoadFailures = new Map<string, number>();
let ortPatched = false;
let activeSpeakerId = 0;
// Chinese pinyin voices can't go through the library's eSpeak step (see pinyin.ts), so their
// ONNX sessions are captured when the library creates them and run directly instead.
type OrtSession = { run: (feeds: Record<string, unknown>) => Promise<Record<string, { data: Float32Array }>> };
type OrtModule = { Tensor: new (type: string, data: unknown, dims?: number[]) => unknown };
const pinyinSessions = new Map<string, OrtSession>();
let captureModelId: string | null = null;
let ortForPinyin: OrtModule | null = null;
const PINYIN_SCALES: Record<string, [number, number, number]> = {
  'zh_CN-xiao_ya-medium': [0.667, 1.0, 0.8],
  'zh_CN-chaowen-medium': [0.5, 1.0, 0.333],
};
const PINYIN_SAMPLE_RATE = 22050;
const pinyinModels = new Set(PIPER_VOICES.filter((v) => v.phonemeType === 'pinyin').map((v) => v.modelId));
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
    if (captureModelId) {
      pinyinSessions.set(captureModelId, session as unknown as OrtSession);
      ortForPinyin = ort as unknown as OrtModule;
      captureModelId = null;
    }
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

// Speaks Chinese text with a pinyin voice: one piece at a time, joined into one 16-bit WAV.
async function predictPinyin(modelId: string, text: string): Promise<Blob> {
  const session = pinyinSessions.get(modelId);
  const scales = PINYIN_SCALES[modelId];
  const ort = ortForPinyin;
  if (!session || !scales || !ort) throw new Error('Chinese voice is not loaded');
  const pieces = splitChineseForSpeech(text);
  const clips: Float32Array[] = [];
  const gap = new Float32Array(Math.round(PINYIN_SAMPLE_RATE * 0.15));
  for (const piece of pieces) {
    const ids = pinyinPhonemeIds(piece);
    if (ids.length <= 2) continue;
    const { output } = await session.run({
      input: new ort.Tensor('int64', ids, [1, ids.length]),
      input_lengths: new ort.Tensor('int64', [ids.length], [1]),
      scales: new ort.Tensor('float32', Float32Array.from(scales), [3]),
    });
    if (clips.length) clips.push(gap);
    clips.push(output.data);
  }
  if (clips.length === 0) throw new Error('No Chinese text to speak.');
  const total = clips.reduce((sum, clip) => sum + clip.length, 0);
  const wav = new DataView(new ArrayBuffer(44 + total * 2));
  const writeText = (offset: number, value: string) => {
    for (let n = 0; n < value.length; n += 1) wav.setUint8(offset + n, value.charCodeAt(n));
  };
  writeText(0, 'RIFF');
  wav.setUint32(4, 36 + total * 2, true);
  writeText(8, 'WAVEfmt ');
  wav.setUint32(16, 16, true);
  wav.setUint16(20, 1, true);
  wav.setUint16(22, 1, true);
  wav.setUint32(24, PINYIN_SAMPLE_RATE, true);
  wav.setUint32(28, PINYIN_SAMPLE_RATE * 2, true);
  wav.setUint16(32, 2, true);
  wav.setUint16(34, 16, true);
  writeText(36, 'data');
  wav.setUint32(40, total * 2, true);
  let at = 44;
  for (const clip of clips) {
    for (let n = 0; n < clip.length; n += 1) {
      const v = Math.max(-1, Math.min(1, clip[n]));
      wav.setInt16(at, v < 0 ? v * 32768 : v * 32767, true);
      at += 2;
    }
  }
  return new Blob([wav], { type: 'audio/x-wav' });
}

function predictFor(session: TtsSession, modelId: string, text: string): Promise<Blob> {
  return pinyinModels.has(modelId) ? predictPinyin(modelId, text) : session.predict(text);
}

function warmupText(modelId: string): string {
  return pinyinModels.has(modelId) ? '你好。' : 'Hello.';
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
  captureModelId = pinyinModels.has(modelId) ? modelId : null;
  // A voice saved on this device only loads from storage, so report no download percentage
  // (the UI then says "Loading voice" instead of "Downloading voice").
  const alreadySaved = await stored().then((ids) => ids.includes(modelId), () => false);
  workerScope.postMessage({
    type: 'status',
    modelId,
    status: 'downloading',
    progress: alreadySaved ? undefined : 0,
  });

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
    savedLoadFailures.delete(modelId);
    sessionCache.set(modelId, session);
    workerScope.postMessage({ type: 'status', modelId, status: 'ready', progress: 100 });
    return session;
  } catch (error) {
    loading = false;
    captureModelId = null;
    (TtsSession as unknown as { _instance: TtsSession | null })._instance = null;
    sessionCache.delete(modelId);
    // A fresh download that fails to load is likely truncated, so drop it. A voice that was
    // already saved is kept unless it fails again, so a brief offline error doesn't erase it.
    const failures = alreadySaved ? (savedLoadFailures.get(modelId) ?? 0) + 1 : 0;
    if (alreadySaved && failures < 2) {
      savedLoadFailures.set(modelId, failures);
    } else {
      savedLoadFailures.delete(modelId);
      await remove(modelId).catch(() => undefined);
    }
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

  if (data.type === 'listStored') {
    void stored().then(
      (modelIds) => workerScope.postMessage({ type: 'stored', requestId: data.requestId, modelIds }),
      () => workerScope.postMessage({ type: 'stored', requestId: data.requestId, modelIds: [] }),
    );
    return;
  }

  if (data.type === 'save') {
    // Save for offline: load the voice (downloading it if needed) and speak once, which also
    // fetches the shared runtimes (/ort/, /piper/) so the service worker keeps them.
    runSerialized(async () => {
      try {
        const session = await ensureSession(data.modelId);
        if (!warmedModels.has(data.modelId)) {
          warmedModels.add(data.modelId);
          await predictFor(session, data.modelId, warmupText(data.modelId));
        }
        workerScope.postMessage({ type: 'saved', requestId: data.requestId, ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not save voice';
        workerScope.postMessage({ type: 'saved', requestId: data.requestId, ok: false, error: message });
      }
    });
    return;
  }

  if (data.type === 'preload') {
    runSerialized(async () => {
      try {
        const session = await ensureSession(data.modelId);
        if (!warmedModels.has(data.modelId)) {
          warmedModels.add(data.modelId);
          await predictFor(session, data.modelId, warmupText(data.modelId)).catch(() => undefined);
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
        const wavBlob = await predictFor(session, data.modelId, data.text);
        if (cancelledJobs.has(data.jobId)) return;
        const wavBuffer = boostQuietWav(await wavBlob.arrayBuffer());
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
