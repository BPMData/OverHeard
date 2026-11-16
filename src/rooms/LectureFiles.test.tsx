// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { formatLectureFilename, LectureFiles } from './LectureFiles';
import { emptyLecture, roomJson } from './protocol';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('validates a local JSON file before replacing the lecture', async () => {
  const onImport = vi.fn();
  render(<LectureFiles state={emptyLecture()} onImport={onImport} />);
  fireEvent.change(screen.getByLabelText('Import lecture JSON'), { target: { files: [{ size: 5, text: async () => '{}' }] } });
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  expect(onImport).not.toHaveBeenCalled();
  const state = { ...emptyLecture(), selectedLangs: ['ar' as const], entries: [{ id: 'one', timestamp: 0, english: 'Hello', translations: { ar: 'مرحبا' }, failedLangs: {} }] };
  fireEvent.change(screen.getByLabelText('Import lecture JSON'), { target: { files: [{ size: 200, text: async () => roomJson(state) }] } });
  await waitFor(() => expect(onImport).toHaveBeenCalledWith({ entries: state.entries, selectedLangs: ['ar'] }));
  expect(screen.queryByRole('alert')).toBeNull();
});

it('formats legible export filenames with room name, weekday, month, ordinal day, and year', () => {
  expect(formatLectureFilename('piper-test-001', new Date(2026, 10, 11))).toBe(
    'Lecture for piper-test-001 on Wednesday, November 11th, 2026.json',
  );
  expect(formatLectureFilename('cs-1', new Date(2026, 10, 1))).toBe(
    'Lecture for cs-1 on Sunday, November 1st, 2026.json',
  );
  expect(formatLectureFilename('cs-2', new Date(2026, 10, 2))).toBe(
    'Lecture for cs-2 on Monday, November 2nd, 2026.json',
  );
  expect(formatLectureFilename('cs-3', new Date(2026, 10, 3))).toBe(
    'Lecture for cs-3 on Tuesday, November 3rd, 2026.json',
  );
  expect(formatLectureFilename('cs-21', new Date(2026, 10, 21))).toBe(
    'Lecture for cs-21 on Saturday, November 21st, 2026.json',
  );
  expect(formatLectureFilename(undefined, new Date(2026, 10, 10))).toBe(
    'Lecture on Tuesday, November 10th, 2026.json',
  );
});
