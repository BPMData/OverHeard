// Meta MMS voices, run inside the voice worker (piperWorker.ts). Each voice is one int8 VITS
// ONNX model that downloads once into OPFS under mms/<modelId>.onnx. The character tokenizer
// is in mmsTokenizer.ts and the vocabularies ship with the app (mmsVocab.ts).
import { mmsInputIds, splitForMms } from './mmsTokenizer';
import { MMS_VOCABS } from './mmsVocab';
import type { PiperVoiceOption } from './voices';
import { encodeWav } from './wav';

export const MMS_DIR = 'mms';
export const MMS_SAMPLE_RATE = 16000;

type OrtTensor = unknown;
export interface OrtLike {
  env?: { wasm?: { numThreads?: number; wasmPaths?: unknown } };
  Tensor: new (type: string, data: unknown, dims?: number[]) => OrtTensor;
  InferenceSession: {
    create: (model: ArrayBuffer | Uint8Array, options?: Record<string, unknown>) => Promise<OrtSessionLike>;
  };
}
export interface OrtSessionLike {
  run: (feeds: Record<string, OrtTensor>) => Promise<Record<string, { data: unknown }>>;
  release?: () => Promise<void>;
}

export interface MmsSession {
  modelId: string;
  iso3: string;
  session: OrtSessionLike;
}

const fileName = (modelId: string) => `${modelId}.onnx`;

async function mmsDirectory(create: boolean): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(MMS_DIR, { create });
  } catch {
    return null;
  }
}

async function readSaved(modelId: string): Promise<File | null> {
  const dir = await mmsDirectory(false);
  if (!dir) return null;
  try {
    const file = await (await dir.getFileHandle(fileName(modelId))).getFile();
    return file.size > 0 ? file : null;
  } catch {
    return null;
  }
}

export async function isMmsSaved(modelId: string): Promise<boolean> {
  return (await readSaved(modelId)) !== null;
}

/**
 * Downloads a model with progress (0–99). Rejects when the body isn't `expectedBytes` long.
 * The size comes from voices.ts, not Content-Length: GitHub Pages gzips the file, so that header
 * gives the compressed size while the body arrives decompressed.
 */
export async function downloadMmsModel(
  url: string,
  expectedBytes: number,
  onProgress: (pct: number) => void,
  fetchImpl: typeof fetch = fetch
): Promise<Uint8Array> {
  const response = await fetchImpl(url, { mode: 'cors' });
  if (!response.ok) throw new Error(`Voice download failed (HTTP ${response.status})`);
  const total = expectedBytes > 0 ? expectedBytes : 0;
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (total > 0 && bytes.length !== total) throw new Error('Voice download was interrupted');
    onProgress(99);
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let reported = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total > 0) {
      const pct = Math.min(99, Math.round((received / total) * 100));
      if (pct > reported) {
        reported = pct;
        onProgress(pct);
      }
    }
  }
  if (total > 0 && received !== total) throw new Error('Voice download was interrupted');
  const bytes = new Uint8Array(received);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}

async function save(modelId: string, bytes: Uint8Array): Promise<void> {
  const dir = await mmsDirectory(true);
  if (!dir) throw new Error('OPFS storage unavailable');
  const handle = await dir.getFileHandle(fileName(modelId), { create: true });
  // createWritable commits on close, so an interrupted write leaves no half file behind.
  const writable = await handle.createWritable();
  await writable.write(bytes as unknown as BufferSource);
  await writable.close();
}

/**
 * The model bytes: from OPFS when saved, otherwise downloaded and saved. `saved` says which,
 * so the caller can report "Loading" instead of "Downloading".
 */
export async function loadMmsModel(
  voice: PiperVoiceOption,
  url: string,
  onProgress: (pct: number) => void
): Promise<{ bytes: ArrayBuffer; saved: boolean }> {
  const saved = await readSaved(voice.modelId);
  if (saved) return { bytes: await saved.arrayBuffer(), saved: true };
  const bytes = await downloadMmsModel(url, voice.downloadBytes ?? 0, onProgress);
  await save(voice.modelId, bytes);
  return { bytes: bytes.buffer as ArrayBuffer, saved: false };
}

export async function createMmsSession(ort: OrtLike, voice: PiperVoiceOption, model: ArrayBuffer): Promise<MmsSession> {
  if (!voice.mmsIso3 || !MMS_VOCABS[voice.mmsIso3]) throw new Error(`No vocabulary for ${voice.modelId}`);
  const session = await ort.InferenceSession.create(new Uint8Array(model), { executionProviders: ['wasm'] });
  return { modelId: voice.modelId, iso3: voice.mmsIso3, session };
}

/** Speaks text one sentence at a time and joins the pieces into one 16 kHz WAV. */
export async function predictMms(ort: OrtLike, mms: MmsSession, text: string): Promise<Blob> {
  const vocab = MMS_VOCABS[mms.iso3];
  const clips: Float32Array[] = [];
  for (const piece of splitForMms(text)) {
    const ids = mmsInputIds(piece, vocab);
    if (ids.length <= 1) continue;
    const n = ids.length;
    const outputs = await mms.session.run({
      input_ids: new ort.Tensor(
        'int64',
        BigInt64Array.from(ids, (id) => BigInt(id)),
        [1, n]
      ),
      attention_mask: new ort.Tensor('int64', new BigInt64Array(n).fill(BigInt(1)), [1, n]),
    });
    const waveform = outputs.waveform?.data;
    if (waveform instanceof Float32Array && waveform.length > 0) clips.push(waveform);
  }
  if (clips.length === 0) throw new Error('Nothing this voice can read aloud.');
  return encodeWav(clips, MMS_SAMPLE_RATE);
}

/** Bytes per saved MMS model. Anything else in the folder is grouped under '' (leftovers). */
export async function mmsStoredSizes(
  knownModelIds: ReadonlySet<string>
): Promise<Array<{ modelId: string; bytes: number }>> {
  const dir = await mmsDirectory(false);
  if (!dir) return [];
  const result: Array<{ modelId: string; bytes: number }> = [];
  let leftovers = 0;
  const iterable = dir as unknown as { entries: () => AsyncIterable<[string, FileSystemHandle]> };
  for await (const [name, handle] of iterable.entries()) {
    if (handle.kind !== 'file') continue;
    let bytes = 0;
    try {
      bytes = (await (handle as FileSystemFileHandle).getFile()).size;
    } catch {
      continue;
    }
    const modelId = name.endsWith('.onnx') ? name.slice(0, -'.onnx'.length) : '';
    if (modelId && knownModelIds.has(modelId) && bytes > 0) result.push({ modelId, bytes });
    else leftovers += bytes;
  }
  if (leftovers > 0) result.push({ modelId: '', bytes: leftovers });
  return result;
}

export async function mmsStoredIds(knownModelIds: ReadonlySet<string>): Promise<string[]> {
  return (await mmsStoredSizes(knownModelIds)).map((size) => size.modelId).filter(Boolean);
}

/** Deletes one saved model, or with '' every file that isn't a known saved model. */
export async function removeMmsModel(modelId: string, knownModelIds: ReadonlySet<string>): Promise<void> {
  const dir = await mmsDirectory(false);
  if (!dir) return;
  if (modelId) {
    await dir.removeEntry(fileName(modelId)).catch((error: unknown) => {
      if ((error as { name?: string })?.name !== 'NotFoundError') throw error;
    });
    return;
  }
  const names: string[] = [];
  for await (const name of (dir as unknown as { keys: () => AsyncIterable<string> }).keys()) {
    const id = name.endsWith('.onnx') ? name.slice(0, -'.onnx'.length) : '';
    if (!id || !knownModelIds.has(id)) names.push(name);
  }
  for (const name of names) await dir.removeEntry(name, { recursive: true }).catch(() => undefined);
}

export async function removeAllMmsModels(): Promise<void> {
  const root = await navigator.storage.getDirectory();
  await root.removeEntry(MMS_DIR, { recursive: true }).catch((error: unknown) => {
    if ((error as { name?: string })?.name !== 'NotFoundError') throw error;
  });
}
