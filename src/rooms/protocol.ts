import type { LectureEntry } from '../conversation/lectureState.ts';
import type { LanguageCode } from '../types.ts';

export const ROOM_LANGUAGES = ['es', 'pt', 'ar', 'zh', 'vi', 'ht', 'fr', 'uk', 'ru', 'so', 'prs', 'ps', 'hi', 'bn', 'ur', 'id', 'ja', 'sw', 'tr'] as const;
export const MAX_ROOM_ENTRIES = 2000;
export const MAX_ROOM_FILE_BYTES = 8 * 1024 * 1024;
export const normalizeRoomCode = (value: string) => value.trim().toLowerCase();
export const validRoomCode = (value: string) => /^[a-z0-9][a-z0-9-]{2,39}$/.test(value);
// Room codes double as top-level paths here and on the GitHub Pages short-link site
// (bpmdata.github.io/<code>), so never hand out a name either site already uses.
export const RESERVED_ROOM_CODES: ReadonlySet<string> = new Set([
  // OverHeard's own paths
  'api', 'assets', 'ort', 'piper', 'index',
  // bpmdata.github.io pages and project sites
  'allaboard', 'allhail', 'overboard', 'overheard', 'proofer', 'eomd', 'bibleviz',
  'icons', 'privacy', 'terms', 'style', 'theme', 'readme',
]);
export const isReservedRoomCode = (value: string) => RESERVED_ROOM_CODES.has(normalizeRoomCode(value));
export const normalizePin = (value: string) => value.trim();
export const validPin = (value: string) => {
  const pin = normalizePin(value);
  return pin.length >= 4 && pin.length <= 20;
};

export interface LectureState {
  entries: LectureEntry[];
  selectedLangs: LanguageCode[];
  interim: string;
  liveTranslations: Partial<Record<LanguageCode, string>>;
  isListening: boolean;
}

export interface RoomSnapshot extends LectureState {
  revision: number;
  teacherOnline: boolean;
  ended: boolean;
}

export interface RoomRejoinResponse {
  code: string;
  token: string;
  snapshot: RoomSnapshot;
}

export interface RoomPatch extends Omit<LectureState, 'entries'> {
  reset?: boolean;
  entries: LectureEntry[];
  removedIds: string[];
}

export const emptyLecture = (): LectureState => ({
  entries: [], selectedLangs: [], interim: '', liveTranslations: {}, isListening: false,
});

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid room data.');
  return value as Record<string, unknown>;
}

function boundedText(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw new Error('Invalid or oversized room text.');
  return value;
}

export function parseLanguages(value: unknown): LanguageCode[] {
  if (!Array.isArray(value) || value.length > ROOM_LANGUAGES.length ||
      value.some(code => !ROOM_LANGUAGES.includes(code))) throw new Error('Invalid room languages.');
  return [...new Set(value)] as LanguageCode[];
}

function parseTranslations(value: unknown): Partial<Record<LanguageCode, string>> {
  const input = record(value);
  const output: Partial<Record<LanguageCode, string>> = {};
  for (const code of ROOM_LANGUAGES) {
    if (input[code] !== undefined) output[code] = boundedText(input[code], 4000);
  }
  return output;
}

function parseEntries(value: unknown): LectureEntry[] {
  if (!Array.isArray(value)) throw new Error('Invalid lecture entries.');
  const ids = new Set<string>();
  return value.map(raw => {
    const item = record(raw);
    const id = boundedText(item.id, 100);
    const english = boundedText(item.english, 500).trim();
    if (!id || ids.has(id) || !english || typeof item.timestamp !== 'number' ||
        !Number.isFinite(item.timestamp) || Math.abs(item.timestamp) > 8.64e15) throw new Error('Invalid lecture entry.');
    ids.add(id);
    const failed = record(item.failedLangs ?? {});
    const failedLangs: LectureEntry['failedLangs'] = {};
    for (const code of ROOM_LANGUAGES) if (failed[code] === true) failedLangs[code] = true;
    return { id, english, timestamp: item.timestamp, translations: parseTranslations(item.translations ?? {}), failedLangs };
  });
}

export function parsePatch(value: unknown): RoomPatch {
  const input = record(value);
  if (Array.isArray(input.entries) && input.entries.length > MAX_ROOM_ENTRIES) {
    throw new Error(`A room can contain up to ${MAX_ROOM_ENTRIES} lines.`);
  }
  if (!Array.isArray(input.removedIds) || input.removedIds.length > MAX_ROOM_ENTRIES ||
      input.removedIds.some(id => typeof id !== 'string' || id.length > 100) ||
      typeof input.isListening !== 'boolean') throw new Error('Invalid room update.');
  return {
    reset: input.reset === true,
    entries: parseEntries(input.entries), removedIds: input.removedIds,
    selectedLangs: parseLanguages(input.selectedLangs), interim: boundedText(input.interim, 2000),
    liveTranslations: parseTranslations(input.liveTranslations), isListening: input.isListening,
  };
}

export function applyPatch<T extends LectureState>(state: T, patch: RoomPatch): T {
  const removed = new Set(patch.removedIds);
  const entries = new Map((patch.reset ? [] : state.entries).filter(entry => !removed.has(entry.id)).map(entry => [entry.id, entry]));
  for (const entry of patch.entries) entries.set(entry.id, entry);
  if (entries.size > MAX_ROOM_ENTRIES) throw new Error(`Room limit reached (${MAX_ROOM_ENTRIES} lines). Export and clear to continue.`);
  const { removedIds: _, reset: __, ...rest } = patch;
  return { ...state, ...rest, entries: [...entries.values()] };
}

// Portable data only: never export the teacher credential or a live room identity.
export function roomJson(state: Pick<LectureState, 'entries' | 'selectedLangs'>): string {
  const file = { format: 'overheard-lecture', version: 1, exportedAt: new Date().toISOString(),
    selectedLangs: state.selectedLangs, entries: state.entries };
  const pretty = JSON.stringify(file, null, 2);
  if (new TextEncoder().encode(pretty).length <= MAX_ROOM_FILE_BYTES) return pretty;
  const compact = JSON.stringify(file);
  if (new TextEncoder().encode(compact).length <= MAX_ROOM_FILE_BYTES) return compact;
  throw new Error('This lecture exceeds the 8 MB file limit. Your transcript is still open.');
}

export function parseRoomJson(text: string): Pick<LectureState, 'entries' | 'selectedLangs'> {
  if (new TextEncoder().encode(text).length > MAX_ROOM_FILE_BYTES) throw new Error('Room file is too large (8 MB maximum).');
  const input = record(JSON.parse(text));
  if (input.format !== 'overheard-lecture' || input.version !== 1) throw new Error('Choose an OverHeard lecture JSON file (version 1).');
  return { entries: parseEntries(input.entries), selectedLangs: parseLanguages(input.selectedLangs) };
}
