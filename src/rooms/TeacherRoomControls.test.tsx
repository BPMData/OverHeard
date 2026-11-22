// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeacherRoomControls } from './TeacherRoomControls';
import { emptyLecture, type LectureState } from './protocol';
import { recordRoomHistory } from './roomHistory';

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
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
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(screen.getByText(/Enter a room PIN/i)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    // Enter code + PIN and click Rejoin room
    fireEvent.change(screen.getByLabelText('Room code (blank picks a random one)'), {
      target: { value: 'abc123' },
    });
    fireEvent.change(screen.getByLabelText('Room PIN'), { target: { value: '4321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rejoin room' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rejoin' }));

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
    fireEvent.click(screen.getByRole('button', { name: 'Rejoin room' }));
    fireEvent.change(screen.getByLabelText('Room code (blank picks a random one)'), {
      target: { value: 'room-9' },
    });
    fireEvent.change(screen.getByLabelText('Room PIN'), { target: { value: '9999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rejoin' }));

    await waitFor(() => expect(screen.getByText('Room: room-9')).toBeTruthy());
    expect(onRestore).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u, init]) => u === '/api/rooms/room-9' && init?.method === 'PUT')).toBe(true),
    );
  });

  it('shows room history with live statuses, filters live rooms, populates room code on click, and clears history', async () => {
    const now = Date.now();
    recordRoomHistory('old-expired', now - 120_000);
    recordRoomHistory('live-bio', now - 60_000);
    recordRoomHistory('ended-chem', now - 30_000);

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/rooms/live-bio') {
          return { ok: true, status: 200, json: async () => ({ ended: false }) };
        }
        if (url === '/api/rooms/ended-chem') {
          return { ok: true, status: 200, json: async () => ({ ended: true }) };
        }
        if (url === '/api/rooms/old-expired') {
          return { ok: false, status: 404, json: async () => ({ error: 'Not found' }) };
        }
        return { ok: true, status: 200, json: async () => ({ revision: 1 }) };
      }),
    );

    render(<TeacherRoomControls state={emptyLecture()} visible />);

    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(screen.getByRole('region', { name: 'Recent room history' })).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText('Live')).toBeTruthy();
      expect(screen.getByText('Ended · rejoinable')).toBeTruthy();
      expect(screen.getByText('Expired')).toBeTruthy();
    });

    // Live only filter hides ended and expired rooms
    fireEvent.click(screen.getByRole('checkbox', { name: 'Live only' }));
    expect(screen.getByText('live-bio')).toBeTruthy();
    expect(screen.queryByText('ended-chem')).toBeNull();
    expect(screen.queryByText('old-expired')).toBeNull();

    // Clicking a room fills the code input, closes the menu, and focuses PIN
    fireEvent.click(screen.getByRole('button', { name: /live-bio/ }));
    expect(screen.queryByRole('region', { name: 'Recent room history' })).toBeNull();
    expect((screen.getByLabelText('Room code (blank picks a random one)') as HTMLInputElement).value).toBe('live-bio');
    expect(document.activeElement).toBe(screen.getByLabelText('Room PIN'));

    // Clear removes all saved history
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByText('No rooms created on this browser yet.')).toBeTruthy();
  });

  it('closes the create room panel with its X without creating a room', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<TeacherRoomControls state={{ ...emptyLecture() }} visible />);
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    expect(screen.getByRole('dialog', { name: 'Create a room' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close without creating a room' }));
    expect(screen.queryByRole('dialog', { name: 'Create a room' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retries transient room creation errors automatically and offers a manual Retry button if all attempts fail', async () => {
    let createAttempts = 0;
    let shouldFail = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/api/rooms' && init?.method === 'POST') {
          createAttempts += 1;
          if (shouldFail) {
            return new Response('Gateway timeout', { status: 503 });
          }
          return new Response(JSON.stringify({ code: 'retry-ok', token: 'tok-ok' }), { status: 201 });
        }
        return new Response(JSON.stringify({ revision: 1 }), { status: 200 });
      }),
    );

    render(<TeacherRoomControls state={emptyLecture()} visible />);
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    fireEvent.change(screen.getByLabelText('Room PIN'), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy(), { timeout: 4000 });
    expect(createAttempts).toBe(3); // 1 initial + 2 retries
    expect(screen.getByText(/temporarily busy or restarting/i)).toBeTruthy();

    shouldFail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('Room: retry-ok')).toBeTruthy());
    expect(createAttempts).toBe(4);
  });
});

describe('TeacherRoomControls class codes', () => {
  it('reuses the last code, reopens it when still active, and shares a short link', async () => {
    recordRoomHistory('murphy-p3');
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/rooms' && init?.method === 'POST') {
        return { ok: false, status: 409, text: async () => JSON.stringify({ error: 'That room code is already in use.' }) };
      }
      if (url === '/api/rooms/murphy-p3/rejoin') {
        return { ok: true, status: 200, text: async () => JSON.stringify({
          code: 'murphy-p3', token: 'tok', snapshot: { ...emptyLecture(), revision: 1, teacherOnline: true, ended: false } }) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ revision: 2 }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<TeacherRoomControls state={{ ...emptyLecture() }} visible />);

    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    expect((screen.getByLabelText('Room code (blank picks a random one)') as HTMLInputElement).value).toBe('murphy-p3');
    // The saved code is filled in, so the PIN gets focus
    expect(document.activeElement).toBe(screen.getByLabelText('Room PIN'));
    fireEvent.change(screen.getByLabelText('Room PIN'), { target: { value: '4321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(screen.getByText('Room: murphy-p3')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith('/api/rooms/murphy-p3/rejoin', expect.anything());
    expect((screen.getByLabelText('Student room link') as HTMLInputElement).value)
      .toBe(`${window.location.origin}/murphy-p3`);

    fireEvent.click(screen.getByRole('button', { name: 'Show join code' }));
    const card = screen.getByRole('dialog', { name: 'Join this room' });
    expect(card.textContent).toContain(`${window.location.host}/murphy-p3`);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Join this room' })).toBeNull();
  });
});
