// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeacherRoomControls } from './TeacherRoomControls';
import { emptyLecture, type LectureState } from './protocol';

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TeacherRoomControls', () => {
  it('requires a PIN to create a room and joins via PIN while restoring server transcript when local is empty', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/rooms/abc123/rejoin' && init?.method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            code: 'abc123',
            token: 'new-token',
            snapshot: {
              ...emptyLecture(),
              selectedLangs: ['es'],
              entries: [
                {
                  id: 'srv-1',
                  timestamp: 1000,
                  english: 'Welcome back',
                  translations: { es: 'Bienvenidos de nuevo' },
                  failedLangs: {},
                },
              ],
              revision: 2,
              teacherOnline: true,
              ended: false,
            },
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ revision: 3 }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const onRestore = vi.fn();
    const emptyState: LectureState = { ...emptyLecture() };
    const { rerender } = render(
      <TeacherRoomControls state={emptyState} visible onRestore={onRestore} />,
    );

    // Clicking Create room without a PIN shows inline validation without issuing network request
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    expect(screen.getByText(/Enter a room PIN/i)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    // Enter code + PIN and click Rejoin room
    fireEvent.change(screen.getByLabelText('Room code (optional for new)'), {
      target: { value: 'abc123' },
    });
    fireEvent.change(screen.getByLabelText('Room PIN'), { target: { value: '4321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rejoin room' }));

    await waitFor(() => expect(onRestore).toHaveBeenCalledTimes(1));
    expect(onRestore).toHaveBeenCalledWith({
      entries: [
        {
          id: 'srv-1',
          timestamp: 1000,
          english: 'Welcome back',
          translations: { es: 'Bienvenidos de nuevo' },
          failedLangs: {},
        },
      ],
      selectedLangs: ['es'],
    });

    // While React has not yet committed restored entries, sync must NOT wipe the server with reset: true
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(0);

    // Once restored entries commit, sync resumes without sending removedIds
    rerender(
      <TeacherRoomControls
        state={{
          ...emptyLecture(),
          selectedLangs: ['es'],
          entries: onRestore.mock.calls[0][0].entries,
        }}
        visible
        onRestore={onRestore}
      />,
    );
    await waitFor(() => expect(screen.getByText('Room: abc123')).toBeTruthy());
  });

  it('keeps local entries when local lecture is non-empty on rejoin', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/rooms/room-9/rejoin' && init?.method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            code: 'room-9',
            token: 'tok-9',
            snapshot: {
              ...emptyLecture(),
              entries: [
                {
                  id: 'srv-old',
                  timestamp: 500,
                  english: 'Old server line',
                  translations: {},
                  failedLangs: {},
                },
              ],
              revision: 1,
              teacherOnline: true,
              ended: false,
            },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ revision: 2 }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const onRestore = vi.fn();
    const localState: LectureState = {
      ...emptyLecture(),
      entries: [
        {
          id: 'loc-1',
          timestamp: 1000,
          english: 'Local note',
          translations: {},
          failedLangs: {},
        },
      ],
    };

    render(<TeacherRoomControls state={localState} visible onRestore={onRestore} />);
    fireEvent.change(screen.getByLabelText('Room code (optional for new)'), {
      target: { value: 'room-9' },
    });
    fireEvent.change(screen.getByLabelText('Room PIN'), { target: { value: '9999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rejoin room' }));

    await waitFor(() => expect(screen.getByText('Room: room-9')).toBeTruthy());
    expect(onRestore).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u, init]) => u === '/api/rooms/room-9' && init?.method === 'PUT')).toBe(true),
    );
  });
});
