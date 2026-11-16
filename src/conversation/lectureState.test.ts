// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  LECTURE_STORAGE_KEY,
  createLectureEntry,
  lectureCsv,
  lectureReducer,
  loadLectureEntries,
  saveLectureEntries,
} from './lectureState';

beforeEach(() => {
  localStorage.clear();
});

describe('lectureState', () => {
  it('adds, resolves, marks failures, and clears lecture entries', () => {
    const entry = createLectureEntry('Hello class', 1_700_000_000_000);
    let list = lectureReducer([], { type: 'add', entry });
    expect(list).toHaveLength(1);

    list = lectureReducer(list, {
      type: 'resolve',
      id: entry.id,
      lang: 'es',
      translation: 'Hola clase',
    });
    list = lectureReducer(list, {
      type: 'resolve',
      id: entry.id,
      lang: 'pt',
      translation: null,
    });

    expect(list[0].translations.es).toBe('Hola clase');
    expect(list[0].failedLangs.pt).toBe(true);

    // Resolving a previously failed language clears the failure flag
    list = lectureReducer(list, {
      type: 'resolve',
      id: entry.id,
      lang: 'pt',
      translation: 'Olá turma',
    });
    expect(list[0].translations.pt).toBe('Olá turma');
    expect(list[0].failedLangs.pt).toBeUndefined();

    expect(lectureReducer(list, { type: 'clear' })).toEqual([]);
  });

  it('persists entries in localStorage until cleared and ignores corrupt entries', () => {
    const first = createLectureEntry('First sentence', 1_700_000_000_000);
    const resolved = lectureReducer([first], {
      type: 'resolve',
      id: first.id,
      lang: 'es',
      translation: 'Primera oración',
    });
    saveLectureEntries(resolved);

    const loaded = loadLectureEntries();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].english).toBe('First sentence');
    expect(loaded[0].translations.es).toBe('Primera oración');

    saveLectureEntries([]);
    expect(localStorage.getItem(LECTURE_STORAGE_KEY)).toBeNull();

    localStorage.setItem(
      LECTURE_STORAGE_KEY,
      JSON.stringify([{ english: '  ' }, { id: 'ok', timestamp: 123, english: 'Valid line' }]),
    );
    expect(loadLectureEntries()).toHaveLength(1);
    expect(loadLectureEntries()[0].english).toBe('Valid line');
  });

  it('exports a UTF-8 BOM multi-column CSV including extra recorded languages', () => {
    const entry = {
      ...createLectureEntry('Open "page 5"', 1_700_000_000_000),
      translations: { es: 'Abran la "página 5"', fr: 'Ouvrez la page 5' },
    };
    const csv = lectureCsv([entry], ['es', 'pt']);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe('"timestamp","english","es","pt","fr"');
    expect(lines[1]).toContain('"Open ""page 5"""');
    expect(lines[1]).toContain('"Abran la ""página 5"""');
    expect(lines[1]).toContain('""');
    expect(lines[1]).toContain('"Ouvrez la page 5"');
  });
});
