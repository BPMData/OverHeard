import type { ConversationLanguage } from '../types';
import { BROWSER_VOICE_ID, findPiperVoice, hasPiperVoices, resolveVoiceId, type VoiceEngine } from './voices';

export interface PiperModelStatus {
  modelId: string | null;
  status: 'idle' | 'downloading' | 'ready' | 'error';
  progress: number | null;
  error?: string;
}

export interface PlaybackHandle {
  pause: () => void;
  resume: () => void;
  stop: () => void;
}

export interface SpeakOptions {
  lang: ConversationLanguage;
  voiceId?: string;
  onDownloading?: (progress: number | null) => void;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (err: Error) => void;
}

export interface SpeechClient {
  isPiperSupported: () => boolean;
  shouldUsePiper: (lang: ConversationLanguage, voiceId?: string) => boolean;
  preloadVoice: (voiceId: string) => void;
  prefetch: (text: string, voiceId: string) => void;
  speak: (text: string, options: SpeakOptions) => PlaybackHandle;
  subscribeStatus: (listener: (status: PiperModelStatus) => void) => () => void;
  unlockAudio: () => void;
  /** Download a voice and the shared voice runtime now, so read-aloud works offline later. */
  saveForOffline?: (voiceId: string) => Promise<void>;
  /** Model ids of the voices (Piper and MMS) already saved on this device. */
  listSavedModels?: () => Promise<string[]>;
  /**
   * Bytes on disk per saved model id of one engine (default Piper). modelId '' collects
   * leftover files (interrupted downloads).
   */
  listSavedSizes?: (engine?: VoiceEngine) => Promise<SavedModelSize[]>;
  /** Delete one saved voice model ('' deletes the leftovers). It downloads again when next used. */
  removeSavedModel?: (modelId: string, engine?: VoiceEngine) => Promise<void>;
  /** Delete every saved voice model of one engine (default Piper). */
  removeAllSavedModels?: (engine?: VoiceEngine) => Promise<void>;
}

export interface SavedModelSize {
  modelId: string;
  bytes: number;
}

type WorkerEvent =
  | { type: 'status'; modelId: string; status: 'downloading' | 'ready' | 'error'; progress?: number; error?: string }
  | { type: 'wav'; jobId: number; wavBuffer: ArrayBuffer }
  | { type: 'error'; jobId: number; error: string }
  | { type: 'saved'; requestId: number; ok: boolean; error?: string }
  | { type: 'stored'; requestId: number; modelIds: string[] }
  | { type: 'storedSizes'; requestId: number; sizes: SavedModelSize[] }
  | { type: 'removed'; requestId: number; ok: boolean; error?: string };

type RequestResult = string[] | SavedModelSize[] | void;

const CHUNK_EDGE_FADE_MS = 8;
const MAX_PREFETCH_ENTRIES = 6;

export function applyEdgeFadeToAudioBuffer(buffer: AudioBuffer, fadeMs = CHUNK_EDGE_FADE_MS): AudioBuffer {
  if (
    !buffer ||
    typeof buffer.getChannelData !== 'function' ||
    !Number.isFinite(buffer.sampleRate) ||
    buffer.sampleRate <= 0
  ) {
    return buffer;
  }
  const desiredFrames = Math.round((buffer.sampleRate * fadeMs) / 1000);
  for (let c = 0; c < buffer.numberOfChannels; c += 1) {
    const samples = buffer.getChannelData(c);
    const fadeFrames = Math.min(Math.floor(samples.length / 2), desiredFrames);
    if (fadeFrames <= 0) continue;
    for (let i = 0; i < fadeFrames; i += 1) {
      samples[i] *= i / fadeFrames;
      samples[samples.length - fadeFrames + i] *= (fadeFrames - 1 - i) / fadeFrames;
    }
  }
  return buffer;
}

export function isPiperSupported(): boolean {
  if (typeof Worker === 'undefined' || typeof navigator === 'undefined' || typeof window === 'undefined') {
    return false;
  }
  if (!navigator.storage || typeof navigator.storage.getDirectory !== 'function') {
    return false;
  }
  const AudioCtx =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return typeof AudioCtx === 'function';
}

function speakWithBrowserSynthesis(text: string, options: SpeakOptions): PlaybackHandle {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  const UtteranceCtor = typeof SpeechSynthesisUtterance !== 'undefined' ? SpeechSynthesisUtterance : undefined;

  if (!synth || !UtteranceCtor) {
    queueMicrotask(() => options.onEnd?.());
    return { pause: () => undefined, resume: () => undefined, stop: () => undefined };
  }

  let cancelled = false;
  let settled = false;
  const utterance = new UtteranceCtor(text);
  utterance.lang = options.lang;
  const voices = synth.getVoices();
  utterance.voice = voices.find((v) => v.lang.toLowerCase().startsWith(options.lang.toLowerCase())) || null;

  const finish = () => {
    if (cancelled || settled) return;
    settled = true;
    options.onEnd?.();
  };

  utterance.onend = finish;
  utterance.onerror = finish;
  options.onStart?.();
  synth.speak(utterance);

  return {
    pause: () => {
      if (!cancelled) synth.pause?.();
    },
    resume: () => {
      if (!cancelled) synth.resume?.();
    },
    stop: () => {
      if (cancelled) return;
      cancelled = true;
      utterance.onend = null;
      utterance.onerror = null;
      synth.cancel();
    },
  };
}

export class PiperPlaybackClient implements SpeechClient {
  private worker: Worker | null = null;
  private audioCtx: AudioContext | null = null;
  private nextJobId = 1;
  private status: PiperModelStatus = { modelId: null, status: 'idle', progress: null };
  private statusListeners = new Set<(status: PiperModelStatus) => void>();
  private pendingJobs = new Map<number, { resolve: (wav: ArrayBuffer) => void; reject: (err: Error) => void }>();
  private prefetchCache = new Map<string, Promise<ArrayBuffer>>();
  private nextRequestId = 1;
  private pendingRequests = new Map<
    number,
    { resolve: (value: RequestResult) => void; reject: (err: Error) => void }
  >();

  isPiperSupported = (): boolean => isPiperSupported();

  shouldUsePiper = (lang: ConversationLanguage, voiceId?: string): boolean => {
    if (!this.isPiperSupported() || !hasPiperVoices(lang)) return false;
    const resolved = voiceId ?? resolveVoiceId(lang);
    return resolved !== BROWSER_VOICE_ID && Boolean(findPiperVoice(resolved));
  };

  subscribeStatus = (listener: (status: PiperModelStatus) => void): (() => void) => {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => {
      this.statusListeners.delete(listener);
    };
  };

  private setStatus(next: PiperModelStatus): void {
    this.status = next;
    for (const listener of this.statusListeners) {
      listener(next);
    }
  }

  private getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    try {
      if (!this.audioCtx || this.audioCtx.state === 'closed') {
        const AudioCtx =
          window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return null;
        this.audioCtx = new AudioCtx();
      }
      return this.audioCtx;
    } catch {
      return null;
    }
  }

  unlockAudio = (): void => {
    const ctx = this.getAudioContext();
    if (!ctx) return;
    try {
      if (ctx.state === 'suspended') {
        void ctx.resume().catch(() => undefined);
      }
    } catch {
      // Ignore AudioContext unlock errors.
    }
  };

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./piperWorker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event: MessageEvent<WorkerEvent>) => {
      const msg = event.data;
      if (!msg) return;
      if (msg.type === 'status') {
        this.setStatus({
          modelId: msg.modelId,
          status: msg.status,
          progress: typeof msg.progress === 'number' ? msg.progress : null,
          error: msg.error,
        });
        return;
      }
      if (msg.type === 'wav') {
        const pending = this.pendingJobs.get(msg.jobId);
        if (pending) {
          this.pendingJobs.delete(msg.jobId);
          pending.resolve(msg.wavBuffer);
        }
        return;
      }
      if (msg.type === 'saved' || msg.type === 'stored' || msg.type === 'storedSizes' || msg.type === 'removed') {
        const pending = this.pendingRequests.get(msg.requestId);
        if (!pending) return;
        this.pendingRequests.delete(msg.requestId);
        if (msg.type === 'stored') pending.resolve(msg.modelIds);
        else if (msg.type === 'storedSizes') pending.resolve(msg.sizes);
        else if (msg.ok) pending.resolve();
        else
          pending.reject(
            new Error(msg.error || (msg.type === 'saved' ? 'Could not save voice' : 'Could not delete voice'))
          );
        return;
      }
      if (msg.type === 'error') {
        const pending = this.pendingJobs.get(msg.jobId);
        if (pending) {
          this.pendingJobs.delete(msg.jobId);
          pending.reject(new Error(msg.error));
        }
      }
    });

    worker.addEventListener('error', (event) => {
      const err = new Error(event.message || 'Piper worker error');
      this.setStatus({ modelId: this.status.modelId, status: 'error', progress: null, error: err.message });
      for (const [, pending] of this.pendingJobs) {
        pending.reject(err);
      }
      this.pendingJobs.clear();
      for (const [, pending] of this.pendingRequests) {
        pending.reject(err);
      }
      this.pendingRequests.clear();
      this.prefetchCache.clear();
      this.worker = null;
    });

    this.worker = worker;
    return worker;
  }

  preloadVoice = (voiceId: string): void => {
    if (!this.isPiperSupported() || voiceId === BROWSER_VOICE_ID) return;
    const voice = findPiperVoice(voiceId);
    if (!voice) return;
    const worker = this.ensureWorker();
    worker.postMessage({ type: 'preload', modelId: voice.modelId });
  };

  private request<T extends RequestResult>(message: Record<string, unknown>): Promise<T> {
    const requestId = this.nextRequestId++;
    const worker = this.ensureWorker();
    return new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(requestId, {
        resolve: resolve as (value: RequestResult) => void,
        reject,
      });
      worker.postMessage({ ...message, requestId });
    });
  }

  saveForOffline = async (voiceId: string): Promise<void> => {
    const voice = findPiperVoice(voiceId);
    if (!this.isPiperSupported() || !voice) return;
    await this.request<void>({ type: 'save', modelId: voice.modelId });
  };

  listSavedModels = async (): Promise<string[]> => {
    if (!this.isPiperSupported()) return [];
    return this.request<string[]>({ type: 'listStored' });
  };

  listSavedSizes = async (engine: VoiceEngine = 'piper'): Promise<SavedModelSize[]> => {
    if (!this.isPiperSupported()) return [];
    return this.request<SavedModelSize[]>({ type: 'listStoredSizes', engine });
  };

  removeSavedModel = async (modelId: string, engine: VoiceEngine = 'piper'): Promise<void> => {
    if (!this.isPiperSupported()) return;
    this.prefetchCache.clear();
    await this.request<void>({ type: 'remove', modelId, engine });
  };

  removeAllSavedModels = async (engine: VoiceEngine = 'piper'): Promise<void> => {
    if (!this.isPiperSupported()) return;
    this.prefetchCache.clear();
    await this.request<void>({ type: 'removeAll', engine });
  };

  private synthesize(
    text: string,
    modelId: string,
    speakerId: number
  ): { jobId: number | null; promise: Promise<ArrayBuffer> } {
    const cacheKey = `${modelId}:${speakerId}:${text}`;
    const existing = this.prefetchCache.get(cacheKey);
    if (existing) {
      this.prefetchCache.delete(cacheKey);
      return { jobId: null, promise: existing };
    }

    const jobId = this.nextJobId++;
    const worker = this.ensureWorker();
    const promise = new Promise<ArrayBuffer>((resolve, reject) => {
      this.pendingJobs.set(jobId, { resolve, reject });
      worker.postMessage({ type: 'synthesize', jobId, modelId, speakerId, text });
    });

    return { jobId, promise };
  }

  prefetch = (text: string, voiceId: string): void => {
    const trimmed = text.trim();
    if (!trimmed || !this.isPiperSupported() || voiceId === BROWSER_VOICE_ID) return;
    const voice = findPiperVoice(voiceId);
    if (!voice) return;
    const cacheKey = `${voice.modelId}:${voice.speakerId}:${trimmed}`;
    if (this.prefetchCache.has(cacheKey)) return;

    if (this.prefetchCache.size >= MAX_PREFETCH_ENTRIES) {
      const oldest = this.prefetchCache.keys().next().value;
      if (oldest) this.prefetchCache.delete(oldest);
    }

    const { promise } = this.synthesize(trimmed, voice.modelId, voice.speakerId);
    const guarded = promise.catch((err) => {
      this.prefetchCache.delete(cacheKey);
      throw err;
    });
    this.prefetchCache.set(cacheKey, guarded);
  };

  private cancelJob(jobId: number): void {
    const pending = this.pendingJobs.get(jobId);
    if (pending) {
      this.pendingJobs.delete(jobId);
      pending.reject(new Error('Job cancelled'));
    }
    this.worker?.postMessage({ type: 'cancelJob', jobId });
  }

  speak = (text: string, options: SpeakOptions): PlaybackHandle => {
    const trimmed = text.trim();
    if (!trimmed) {
      queueMicrotask(() => options.onEnd?.());
      return { pause: () => undefined, resume: () => undefined, stop: () => undefined };
    }

    const voiceId = options.voiceId ?? resolveVoiceId(options.lang);
    const voice = findPiperVoice(voiceId);

    if (!this.shouldUsePiper(options.lang, voiceId) || !voice) {
      return speakWithBrowserSynthesis(trimmed, options);
    }

    this.unlockAudio();

    let cancelled = false;
    let paused = false;
    let activeJobId: number | null = null;
    let decodedBuffer: AudioBuffer | null = null;
    let activeNode: AudioBufferSourceNode | null = null;
    let startedAt = 0;
    let playedOffset = 0;
    let fallbackHandle: PlaybackHandle | null = null;

    const cleanupNode = () => {
      if (!activeNode) return;
      activeNode.onended = null;
      try {
        activeNode.stop();
      } catch {
        // Already stopped.
      }
      try {
        activeNode.disconnect();
      } catch {
        // Ignore disconnect failures.
      }
      activeNode = null;
    };

    const scheduleFrom = (ctx: AudioContext, buffer: AudioBuffer, offset: number) => {
      if (cancelled || paused) return;
      cleanupNode();
      const clampedOffset = Math.max(0, Math.min(offset, Math.max(0, buffer.duration - 0.01)));
      const startTime = ctx.currentTime + 0.005;
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(ctx.destination);
      node.onended = () => {
        if (activeNode === node) {
          activeNode = null;
        }
        if (!cancelled && !paused) {
          options.onEnd?.();
        }
      };
      startedAt = startTime;
      playedOffset = clampedOffset;
      activeNode = node;
      node.start(startTime, clampedOffset);
    };

    const unsubscribeStatus = this.subscribeStatus((st) => {
      if (cancelled) return;
      if (st.modelId === voice.modelId && st.status === 'downloading') {
        options.onDownloading?.(st.progress);
      }
    });

    const { jobId, promise } = this.synthesize(trimmed, voice.modelId, voice.speakerId);
    activeJobId = jobId;

    void (async () => {
      try {
        const wavBuffer = await promise;
        activeJobId = null;
        unsubscribeStatus();
        if (cancelled) return;

        const ctx = this.getAudioContext();
        if (!ctx) throw new Error('AudioContext unavailable');
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }
        const buffer = await ctx.decodeAudioData(wavBuffer.slice(0));
        if (cancelled) return;

        applyEdgeFadeToAudioBuffer(buffer);
        decodedBuffer = buffer;
        options.onStart?.();

        if (!paused) {
          scheduleFrom(ctx, buffer, 0);
        }
      } catch (err) {
        activeJobId = null;
        unsubscribeStatus();
        if (cancelled) return;

        // Fall back to system speechSynthesis if Piper fails (e.g., offline without cached voice).
        if (
          typeof window !== 'undefined' &&
          window.speechSynthesis &&
          typeof SpeechSynthesisUtterance !== 'undefined'
        ) {
          fallbackHandle = speakWithBrowserSynthesis(trimmed, options);
          if (paused) fallbackHandle.pause();
          return;
        }

        options.onError?.(err instanceof Error ? err : new Error('Speech synthesis failed'));
      }
    })();

    return {
      pause: () => {
        if (cancelled || paused) return;
        paused = true;
        if (fallbackHandle) {
          fallbackHandle.pause();
          return;
        }
        const ctx = this.getAudioContext();
        if (activeNode && decodedBuffer && ctx) {
          const elapsed = Math.max(0, ctx.currentTime - startedAt);
          playedOffset = Math.min(decodedBuffer.duration, playedOffset + elapsed);
          cleanupNode();
        }
      },
      resume: () => {
        if (cancelled || !paused) return;
        paused = false;
        if (fallbackHandle) {
          fallbackHandle.resume();
          return;
        }
        if (decodedBuffer) {
          if (playedOffset >= decodedBuffer.duration - 0.01) {
            options.onEnd?.();
            return;
          }
          const ctx = this.getAudioContext();
          if (!ctx) return;
          if (ctx.state === 'suspended') {
            void ctx.resume().catch(() => undefined);
          }
          scheduleFrom(ctx, decodedBuffer, playedOffset);
        }
      },
      stop: () => {
        if (cancelled) return;
        cancelled = true;
        paused = false;
        unsubscribeStatus();
        if (activeJobId !== null) {
          this.cancelJob(activeJobId);
          activeJobId = null;
        }
        cleanupNode();
        fallbackHandle?.stop();
        fallbackHandle = null;
      },
    };
  };
}

export const piperClient = new PiperPlaybackClient();
