// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LectureFiles } from './LectureFiles';
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
