import { INFERENCE_PROGRESS_URL, PATH_MAP, TtsSession, remove, stored, type Progress } from '@mintplex-labs/piper-tts-web';
import { boostQuietWav } from './loudness';
import {
  createMmsSession,
  isMmsSaved,
  loadMmsModel,
  mmsStoredIds,
  mmsStoredSizes,
  predictMms,
  removeAllMmsModels,
  removeMmsModel,
  type MmsSession,
  type OrtLike,
} from './mmsEngine';
import { pinyinPhonemeIds, splitChineseForSpeech } from './pinyin';
import { mmsVoiceUrl, PIPER_VOICES, voiceEngine, type PiperVoiceOption, type VoiceEngine } from './voices';
import { encodeWav } from './wav';

const PIPER_WASM_PATHS = {
  onnxWasm: {
    mjs: '/ort/ort-wasm-simd-threaded.jsep.mjs',
    wasm: '/ort/ort-wasm-simd-threaded.jsep.wasm',
  } as unknown as string,
  piperWasm: '/piper/piper_phonemize.wasm',
  piperData: '/piper/piper_phonemize.data',
};

const MAX_CACHED_SESSIONS = 2;

const MMS_VOICES = new Map<string, PiperVoiceOption>(
  PIPER_VOICES.filter((voice) => voiceEngine(voice) === 'mms').map((voice) => [voice.modelId, voice]),
);
const MMS_MODEL_IDS: ReadonlySet<string> = new Set(MMS_VOICES.keys());

for (const voice of PIPER_VOICES) {
  if (voiceEngine(voice) === 'mms') continue;
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
  | { type: 'listStoredSizes'; requestId: number; engine?: VoiceEngine }
  | { type: 'remove'; requestId: number; modelId: string; engine?: VoiceEngine }
  | { type: 'removeAll'; requestId: number; engine?: VoiceEngine }
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
// Meta MMS sessions (see mmsEngine.ts), created directly with ONNX Runtime.
const mmsSessions = new Map<string, MmsSession>();
let ortModule: OrtLike | null = null;
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
  for (const piece of pieces) {
    const ids = pinyinPhonemeIds(piece);
    if (ids.length <= 2) continue;
    const { output } = await session.run({
      input: new ort.Tensor('int64', ids, [1, ids.length]),
      input_lengths: new ort.Tensor('int64', [ids.length], [1]),
      scales: new ort.Tensor('float32', Float32Array.from(scales), [3]),
    });
    clips.push(output.data);
  }
  if (clips.length === 0) throw new Error('No Chinese text to speak.');
  return encodeWav(clips, PINYIN_SAMPLE_RATE);
}

function predictFor(session: TtsSession, modelId: string, text: string): Promise<Blob> {
  return pinyinModels.has(modelId) ? predictPinyin(modelId, text) : session.predict(text);
}

function warmupText(modelId: string): string {
  if (pinyinModels.has(modelId)) return '你好。';
  return MMS_VOICES.has(modelId) ? 'Halo.' : 'Hello.';
}

/** Loads a voice of either engine and returns how to speak with it. */
async function prepareVoice(modelId: string): Promise<(text: string) => Promise<Blob>> {
  if (MMS_VOICES.has(modelId)) {
    const mms = await ensureMmsSession(modelId);
    const ort = await loadOrt();
    return (text) => predictMms(ort, mms, text);
  }
  const session = await ensureSession(modelId);
  return (text) => predictFor(session, modelId, text);
}

/** The same ONNX Runtime the Piper library uses, set up the way the library sets it up. */
async function loadOrt(): Promise<OrtLike> {
  if (ortModule) return ortModule;
  await installSpeakerInterceptor();
  const imported = await import('onnxruntime-web/wasm');
  const ort = (imported.default ?? imported) as unknown as OrtLike;
  if (ort.env?.wasm) {
    ort.env.wasm.numThreads = navigator.hardwareConcurrency;
    ort.env.wasm.wasmPaths = PIPER_WASM_PATHS.onnxWasm;
  }
  ortModule = ort;
  return ort;
}

async function ensureMmsSession(modelId: string): Promise<MmsSession> {
  const cached = mmsSessions.get(modelId);
  if (cached) {
    mmsSessions.delete(modelId);
    mmsSessions.set(modelId, cached);
    return cached;
  }
  const voice = MMS_VOICES.get(modelId);
  if (!voice) throw new Error(`Unknown voice ${modelId}`);
  await verifyOpfs();
  const ort = await loadOrt();
  if (mmsSessions.size >= MAX_CACHED_SESSIONS) {
    const oldest = mmsSessions.keys().next().value;
    if (oldest) {
      void mmsSessions.get(oldest)?.session.release?.().catch(() => undefined);
      mmsSessions.delete(oldest);
    }
  }
  const alreadySaved = await isMmsSaved(modelId).catch(() => false);
  workerScope.postMessage({ type: 'status', modelId, status: 'downloading', progress: alreadySaved ? undefined : 0 });
  try {
    const { bytes } = await loadMmsModel(voice, mmsVoiceUrl(voice), (progress) =>
      workerScope.postMessage({ type: 'status', modelId, status: 'downloading', progress }),
    );
    const mms = await createMmsSession(ort, voice, bytes);
    savedLoadFailures.delete(modelId);
    mmsSessions.set(modelId, mms);
    workerScope.postMessage({ type: 'status', modelId, status: 'ready', progress: 100 });
    return mms;
  } catch (error) {
    // Same policy as Piper voices: drop a fresh download that won't load, but keep a saved
    // voice unless it fails twice (one failure is usually low memory, not a bad file).
    const failures = alreadySaved ? (savedLoadFailures.get(modelId) ?? 0) + 1 : 0;
    if (alreadySaved && failures < 2) {
      savedLoadFailures.set(modelId, failures);
    } else {
      savedLoadFailures.delete(modelId);
      await removeMmsModel(modelId, MMS_MODEL_IDS).catch(() => undefined);
    }
    const message = error instanceof Error ? error.message : 'Failed to load MMS voice';
    workerScope.postMessage({ type: 'status', modelId, status: 'error', error: message });
    throw error;
  }
}

/** Every saved voice's model id, Piper and MMS. */
async function storedModelIds(): Promise<string[]> {
  const [piper, mms] = await Promise.all([
    stored().catch(() => [] as string[]),
    mmsStoredIds(MMS_MODEL_IDS).catch(() => [] as string[]),
  ]);
  return [...piper, ...mms];
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

// The library saves each voice in OPFS under piper/ as <modelId>.onnx and <modelId>.onnx.json.
const PIPER_DIR = 'piper';

async function piperDirectory(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(PIPER_DIR);
  } catch {
    return null; // Nothing saved yet
  }
}

/** Bytes on disk per model id. Files that aren't a known voice are grouped under '' (leftovers). */
async function storedSizes(): Promise<Array<{ modelId: string; bytes: number }>> {
  const dir = await piperDirectory();
  if (!dir) return [];
  const sizes = new Map<string, number>();
  const iterable = dir as unknown as { entries: () => AsyncIterable<[string, FileSystemHandle]> };
  for await (const [name, handle] of iterable.entries()) {
    if (handle.kind !== 'file') continue;
    let bytes = 0;
    try {
      bytes = (await (handle as FileSystemFileHandle).getFile()).size;
    } catch {
      continue;
    }
    const key = name.split('.')[0];
    const modelId = name.endsWith('.onnx') || name.endsWith('.onnx.json') ? key : '';
    sizes.set(modelId, (sizes.get(modelId) ?? 0) + bytes);
  }
  // A .json alone (an interrupted download) isn't a usable voice: count it as a leftover.
  const usable = new Set(await stored().catch(() => [] as string[]));
  const result: Array<{ modelId: string; bytes: number }> = [];
  let leftovers = 0;
  for (const [modelId, bytes] of sizes) {
    if (modelId && usable.has(modelId)) result.push({ modelId, bytes });
    else leftovers += bytes;
  }
  if (leftovers > 0) result.push({ modelId: '', bytes: leftovers });
  return result;
}

function forgetModel(modelId: string): void {
  sessionCache.delete(modelId);
  warmedModels.delete(modelId);
  pinyinSessions.delete(modelId);
  mmsSessions.delete(modelId);
  savedLoadFailures.delete(modelId);
}

async function removeModel(modelId: string): Promise<void> {
  forgetModel(modelId);
  const dir = await piperDirectory();
  if (!dir) return;
  if (!modelId) {
    // Leftovers: every file that isn't part of a usable voice
    const keep = new Set(await stored().catch(() => [] as string[]));
    const names: string[] = [];
    for await (const name of (dir as unknown as { keys: () => AsyncIterable<string> }).keys()) {
      if (!keep.has(name.split('.')[0])) names.push(name);
    }
    for (const name of names) await dir.removeEntry(name, { recursive: true }).catch(() => undefined);
    return;
  }
  for (const name of [`${modelId}.onnx`, `${modelId}.onnx.json`]) {
    await dir.removeEntry(name).catch((error: unknown) => {
      if ((error as { name?: string })?.name !== 'NotFoundError') throw error;
    });
  }
}

async function removeAllModels(engine: VoiceEngine): Promise<void> {
  if (engine === 'mms') {
    for (const modelId of MMS_MODEL_IDS) forgetModel(modelId);
    await removeAllMmsModels();
    return;
  }
  sessionCache.clear();
  for (const modelId of warmedModels) if (!MMS_VOICES.has(modelId)) warmedModels.delete(modelId);
  pinyinSessions.clear();
  for (const modelId of savedLoadFailures.keys()) if (!MMS_VOICES.has(modelId)) savedLoadFailures.delete(modelId);
  (TtsSession as unknown as { _instance: TtsSession | null })._instance = null;
  const root = await navigator.storage.getDirectory();
  await root.removeEntry(PIPER_DIR, { recursive: true }).catch((error: unknown) => {
    if ((error as { name?: string })?.name !== 'NotFoundError') throw error;
  });
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
    void storedModelIds().then(
      (modelIds) => workerScope.postMessage({ type: 'stored', requestId: data.requestId, modelIds }),
      () => workerScope.postMessage({ type: 'stored', requestId: data.requestId, modelIds: [] }),
    );
    return;
  }

  if (data.type === 'listStoredSizes') {
    const sizes = data.engine === 'mms' ? mmsStoredSizes(MMS_MODEL_IDS) : storedSizes();
    void sizes.then(
      (sizes) => workerScope.postMessage({ type: 'storedSizes', requestId: data.requestId, sizes }),
      () => workerScope.postMessage({ type: 'storedSizes', requestId: data.requestId, sizes: [] }),
    );
    return;
  }

  if (data.type === 'remove' || data.type === 'removeAll') {
    // Run in the job queue, so a delete never pulls a file out from under a voice that is loading.
    runSerialized(async () => {
      try {
        if (data.type === 'remove' && data.engine === 'mms') {
          forgetModel(data.modelId);
          await removeMmsModel(data.modelId, MMS_MODEL_IDS);
        } else if (data.type === 'remove') await removeModel(data.modelId);
        else await removeAllModels(data.engine ?? 'piper');
        workerScope.postMessage({ type: 'removed', requestId: data.requestId, ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not delete voice';
        workerScope.postMessage({ type: 'removed', requestId: data.requestId, ok: false, error: message });
      }
    });
    return;
  }

  if (data.type === 'save') {
    // Save for offline: load the voice (downloading it if needed) and speak once, which also
    // fetches the shared runtimes (/ort/, /piper/) so the service worker keeps them.
    runSerialized(async () => {
      try {
        const speak = await prepareVoice(data.modelId);
        if (!warmedModels.has(data.modelId)) {
          warmedModels.add(data.modelId);
          await speak(warmupText(data.modelId));
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
        const speak = await prepareVoice(data.modelId);
        if (!warmedModels.has(data.modelId)) {
          warmedModels.add(data.modelId);
          await speak(warmupText(data.modelId)).catch(() => undefined);
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
        const speak = await prepareVoice(data.modelId);
        if (cancelledJobs.has(data.jobId)) return;
        activeSpeakerId = data.speakerId;
        const wavBlob = await speak(data.text);
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
