// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationMode } from './ConversationMode';

type ResultEvent = {
  resultIndex: number;
  results: Array<{ isFinal: boolean; 0: { transcript: string } }>;
};

class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = '';
  continuous = false;
  interimResults = false;
  processLocally?: boolean;
  onstart: (() => void) | null = null;
  onresult: ((event: ResultEvent) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn(() => this.onstart?.());
  stop = vi.fn();
  abort = vi.fn();
  constructor() {
    FakeRecognition.instances.push(this);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  FakeRecognition.instances = [];
  vi.stubGlobal('SpeechRecognition', FakeRecognition);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('opens and focuses room setup before starting a lecture with simple controls', () => {
  render(<ConversationMode active fontSize={32} isDark translate={vi.fn(async () => '')}
    selectedLangs={['es']} mtPreference="auto" onExit={vi.fn()} onPermissionDenied={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Lecture' }));
  expect(screen.queryByRole('textbox', { name: /Room code/ })).toBeNull();
  const share = screen.getByRole('button', { name: 'Share room code with students' });
  fireEvent.click(share);
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: /Room code/ }));
  fireEvent.click(share);
  fireEvent.click(screen.getByRole('button', { name: 'Start lecture' }));
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: /Room code/ }));
  expect(FakeRecognition.instances).toHaveLength(0);
});

it('shows Clear lecture in simple controls only after the room is ended', async () => {
  vi.useRealTimers();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/rooms' && init?.method === 'POST') {
      return new Response(JSON.stringify({ code: 'bio-p2', token: 'tok' }), { status: 201 });
    }
    return new Response(JSON.stringify({ revision: 1, ok: true }), { status: 200 });
  }));
  vi.stubGlobal('confirm', vi.fn(() => true));
  render(<ConversationMode active fontSize={32} isDark translate={vi.fn(async (text: string) => `es:${text}`)}
    selectedLangs={['es']} mtPreference="auto" onExit={vi.fn()} onPermissionDenied={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Lecture' }));
  fireEvent.click(screen.getByRole('button', { name: 'Share room code with students' }));
  fireEvent.change(screen.getByLabelText('Room PIN'), { target: { value: '1234' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
  await waitFor(() => expect(screen.getByText('Room: bio-p2')).toBeTruthy());
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Share room code with students' })).toBeNull());

  fireEvent.click(screen.getByRole('button', { name: 'Start lecture' }));
  await waitFor(() => expect(FakeRecognition.instances.length).toBeGreaterThan(0));
  act(() => FakeRecognition.instances[0].onresult?.({ resultIndex: 0,
    results: [{ isFinal: true, 0: { transcript: 'Cells divide by mitosis' } }] }));
  await waitFor(() => expect(screen.getByText('Cells divide by mitosis')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'Pause lecture' }));
  // While the room is live, simple controls keep Clear lecture hidden
  expect(screen.queryByRole('button', { name: 'Clear lecture' })).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'End room' }));
  const clear = await screen.findByRole('button', { name: 'Clear lecture' });
  fireEvent.click(clear);
  await waitFor(() => expect(screen.queryByText('Cells divide by mitosis')).toBeNull());
  expect(screen.queryByRole('button', { name: 'Clear lecture' })).toBeNull();
});

describe('ConversationMode Lecture mode', () => {
  it('switches into Lecture mode, streams live English -> multi-language columns, keeps full history, and persists locally', async () => {
    const translate = vi.fn(async (text: string, target: string, source: string) => {
      return `${source}>${target}:${text}`;
    });
    const onOpenLanguages = vi.fn();
    const onExit = vi.fn();

    const { rerender } = render(
      <ConversationMode
        active
        fontSize={32}
        isDark
        translate={translate}
        selectedLangs={['es', 'pt']}
        onOpenLanguages={onOpenLanguages}
        mtPreference="auto"
        onExit={onExit}
        onPermissionDenied={vi.fn()}
      />,
    );

    // Switch to Lecture sub-mode
    fireEvent.click(screen.getByRole('button', { name: 'Lecture' }));
    expect(screen.queryByLabelText('Side A name')).toBeNull();
    expect(screen.getByRole('button', { name: 'Languages: Spanish, Portuguese' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Languages: Spanish, Portuguese' }));
    expect(onOpenLanguages).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Show all controls' }));
    // Start continuous English lecture
    fireEvent.click(screen.getByRole('button', { name: 'Start lecture' }));
    expect(FakeRecognition.instances).toHaveLength(1);
    const rec = FakeRecognition.instances[0];
    expect(rec.lang).toBe('en-US');
    expect(rec.continuous).toBe(true);
    expect(rec.interimResults).toBe(true);
    expect(screen.getByRole('status').textContent).toContain('Listening continuously in English');

    // Interim speech streams live Spanish and Portuguese columns before sentence finishes
    await act(async () => {
      rec.onresult?.({
        resultIndex: 0,
        results: [{ isFinal: false, 0: { transcript: 'Today we will study gravity' } }],
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(screen.getByText('Speaking live…')).toBeTruthy();
    expect(screen.getByText('en>es:Today we will study gravity')).toBeTruthy();
    expect(screen.getByText('en>pt:Today we will study gravity')).toBeTruthy();

    // Finalize first sentence, then speak and finalize a second sentence: both remain permanently visible
    await act(async () => {
      rec.onresult?.({
        resultIndex: 0,
        results: [{ isFinal: true, 0: { transcript: 'First lecture sentence' } }],
      });
    });
    await act(async () => {
      rec.onresult?.({
        resultIndex: 0,
        results: [{ isFinal: true, 0: { transcript: 'Second lecture sentence' } }],
      });
    });

    await act(async () => {});
    expect(screen.getByText('First lecture sentence')).toBeTruthy();
    expect(screen.getByText('en>es:First lecture sentence')).toBeTruthy();
    expect(screen.getByText('en>pt:First lecture sentence')).toBeTruthy();
    expect(screen.getByText('Second lecture sentence')).toBeTruthy();
    expect(screen.getByText('en>es:Second lecture sentence')).toBeTruthy();
    expect(screen.getByText('en>pt:Second lecture sentence')).toBeTruthy();

    // Adding a third language mid-lecture automatically populates the new column for stored lines
    rerender(
      <ConversationMode
        active
        fontSize={32}
        isDark
        translate={translate}
        selectedLangs={['es', 'pt', 'fr']}
        onOpenLanguages={onOpenLanguages}
        mtPreference="auto"
        onExit={onExit}
        onPermissionDenied={vi.fn()}
      />,
    );
    await act(async () => {});
    expect(screen.getByText('en>fr:First lecture sentence')).toBeTruthy();
    expect(screen.getByText('en>fr:Second lecture sentence')).toBeTruthy();

    // Unmount and remount: stored lecture entries and sub-mode choice persist in localStorage
    cleanup();
    render(
      <ConversationMode
        active
        fontSize={32}
        isDark
        translate={translate}
        selectedLangs={['es', 'pt']}
        mtPreference="auto"
        onExit={onExit}
        onPermissionDenied={vi.fn()}
      />,
    );
    expect(screen.getByText('First lecture sentence')).toBeTruthy();
    expect(screen.getByText('Second lecture sentence')).toBeTruthy();

    // Exit stops lecture cleanly and calls onExit
    fireEvent.click(screen.getByRole('button', { name: 'Back to Listening Mode' }));
    expect(onExit).toHaveBeenCalledTimes(1);

    // Confirm Clear lecture removes rows
    vi.stubGlobal('confirm', vi.fn(() => true));
    fireEvent.click(screen.getByRole('button', { name: 'Clear lecture' }));
    expect(screen.queryByText('First lecture sentence')).toBeNull();
  });

  it('allows typing a line directly into the permanent lecture log and stops mic when switching to Two-way', async () => {
    const translate = vi.fn(async (text: string, target: string) => `${target}:${text}`);
    render(
      <ConversationMode
        active
        fontSize={32}
        isDark
        translate={translate}
        selectedLangs={['es', 'pt']}
        mtPreference="auto"
        onExit={vi.fn()}
        onPermissionDenied={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Lecture' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show all controls' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start lecture' }));
    const rec = FakeRecognition.instances[0];

    fireEvent.change(screen.getByLabelText('Lecture line text'), {
      target: { value: 'Quiz starts at noon' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await act(async () => {});

    expect(screen.getByText('Quiz starts at noon')).toBeTruthy();
    expect(screen.getByText('es:Quiz starts at noon')).toBeTruthy();
    expect(screen.getByText('pt:Quiz starts at noon')).toBeTruthy();

    // Switching back to Two-way stops continuous lecture speech
    fireEvent.click(screen.getByRole('button', { name: 'Two-way' }));
    expect(rec.abort).toHaveBeenCalled();
    expect(screen.getByLabelText('Side A name')).toBeTruthy();
  });
});

it('does not pair a late interim translation with newer English speech', async () => {
  let finishOld!: (value: string) => void;
  const translate = vi.fn(() => new Promise<string>(resolve => { finishOld = resolve; }));
  render(<ConversationMode active fontSize={32} isDark translate={translate}
    selectedLangs={['es']} mtPreference="auto" onExit={vi.fn()} onPermissionDenied={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /^Lecture$/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Show all controls' }));
  fireEvent.click(screen.getByRole('button', { name: 'Start lecture' }));
  const rec = FakeRecognition.instances[0];
  await act(async () => rec.onresult?.({ resultIndex: 0,
    results: [{ isFinal: false, 0: { transcript: 'The old sentence has six words' } }] }));
  expect(translate).toHaveBeenCalledTimes(1);
  await act(async () => rec.onresult?.({ resultIndex: 0,
    results: [{ isFinal: false, 0: { transcript: 'A new sentence' } }] }));
  await act(async () => finishOld('Late translation of old English'));
  expect(screen.getByText('A new sentence')).toBeTruthy();
  expect(screen.queryByText('Late translation of old English')).toBeNull();
});

it('suspends teacher lecture speech recognition while reading a cell aloud and resumes when done', async () => {
  class FakeUtterance {
    lang = '';
    voice: { lang: string } | null = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public text: string) {}
  }
  const spokenQueue: FakeUtterance[] = [];
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  vi.stubGlobal('speechSynthesis', {
    speak: vi.fn((u: FakeUtterance) => spokenQueue.push(u)),
    pause: vi.fn(),
    resume: vi.fn(),
    cancel: vi.fn(() => {
      spokenQueue.length = 0;
    }),
    getVoices: () => [{ lang: 'pt-BR' }, { lang: 'es-MX' }],
    get speaking() {
      return spokenQueue.length > 0;
    },
    get pending() {
      return spokenQueue.length > 1;
    },
  });

  const translate = vi.fn(async (text: string, target: string) => `${target}:${text}`);
  render(
    <ConversationMode
      active
      fontSize={32}
      isDark
      translate={translate}
      selectedLangs={['es', 'pt']}
      mtPreference="auto"
      onExit={vi.fn()}
      onPermissionDenied={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: /^Lecture$/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Show all controls' }));
  fireEvent.change(screen.getByLabelText('Playback language'), { target: { value: 'pt' } });
  fireEvent.change(screen.getByLabelText('Voice'), { target: { value: 'pt_BR-cadu-medium' } });
  expect(JSON.parse(localStorage.getItem('overheard.voices')!).pt).toBe('pt_BR-cadu-medium');

  fireEvent.click(screen.getByRole('button', { name: 'Start lecture' }));
  expect(FakeRecognition.instances).toHaveLength(1);
  const firstRec = FakeRecognition.instances[0];

  fireEvent.change(screen.getByLabelText('Lecture line text'), {
    target: { value: 'Open your books' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await act(async () => {});

  // Click read-from-here on Portuguese cell: suspends lecture mic while speaking
  fireEvent.click(screen.getByRole('button', { name: 'Read from #1 in Portuguese' }));
  expect(firstRec.abort).toHaveBeenCalled();
  expect(spokenQueue).toHaveLength(1);
  expect(spokenQueue[0].text).toBe('pt:Open your books');

  // Finishing playback resumes lecture speech recognition automatically
  await act(async () => {
    spokenQueue.shift()?.onend?.();
  });
  expect(FakeRecognition.instances).toHaveLength(2);
});

it('clicking the top-left OverHeard brand stops active lecture capture and calls onHome (or falls back to onExit)', () => {
  const onExit = vi.fn();
  const onHome = vi.fn();
  const translate = vi.fn(async (text: string) => text);
  const { rerender } = render(
    <ConversationMode
      active
      fontSize={32}
      isDark
      translate={translate}
      selectedLangs={['es']}
      mtPreference="auto"
      onExit={onExit}
      onHome={onHome}
      onPermissionDenied={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: /^Lecture$/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Show all controls' }));
  fireEvent.click(screen.getByRole('button', { name: 'Start lecture' }));
  const rec = FakeRecognition.instances[0];
  expect(rec).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'OverHeard — Go to Columns view' }));
  expect(rec.abort).toHaveBeenCalled();
  expect(onHome).toHaveBeenCalledTimes(1);
  expect(onExit).not.toHaveBeenCalled();

  rerender(
    <ConversationMode
      active
      fontSize={32}
      isDark
      translate={translate}
      selectedLangs={['es']}
      mtPreference="auto"
      onExit={onExit}
      onPermissionDenied={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'OverHeard — Go to Columns view' }));
  expect(onExit).toHaveBeenCalledTimes(1);
});

it('streams live translations through a long run-on sentence without a pause', async () => {
  const translate = vi.fn(async (text: string) => `es:${text}`);
  render(<ConversationMode active fontSize={32} isDark translate={translate}
    selectedLangs={['es']} mtPreference="auto" onExit={vi.fn()} onPermissionDenied={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /^Lecture$/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Show all controls' }));
  fireEvent.click(screen.getByRole('button', { name: 'Start lecture' }));
  const rec = FakeRecognition.instances[0];
  const words = Array.from({ length: 120 }, (_, i) => `word${i}`);
  for (let n = 10; n <= words.length; n += 10) {
    const transcript = words.slice(0, n).join(' ');
    await act(async () => rec.onresult?.({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript } }] }));
    await act(async () => { vi.advanceTimersByTime(100); });
  }
  await act(async () => { vi.advanceTimersByTime(400); });
  await act(async () => { vi.advanceTimersByTime(400); });
  // No pause and no final result, yet the live row is translated up to the latest words
  expect(screen.getByText(/es:word0 .*es:.*word119/)).toBeTruthy();
  // Requests stay small instead of growing with the sentence
  const longest = Math.max(...translate.mock.calls.map(([text]) => text.length));
  expect(longest).toBeLessThan(200);
});

it('offers reading while the teacher talks only once Read aloud is on', () => {
  render(<ConversationMode active fontSize={32} isDark translate={vi.fn(async () => '')}
    selectedLangs={['es']} mtPreference="auto" onExit={vi.fn()} onPermissionDenied={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /^Lecture$/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Show all controls' }));
  const live = screen.getByRole('checkbox', { name: 'While I talk (headphones)' }) as HTMLInputElement;
  expect(live.checked).toBe(false);
  expect(live.disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Read aloud' }));
  expect(live.disabled).toBe(false);
  fireEvent.click(live);
  expect(live.checked).toBe(true);
  expect(JSON.parse(localStorage.getItem('overheard.conversation')!).lectureLiveReadAloud).toBe(true);
});

it('pops the teacher lecture out into a floating window from the full toolbar', async () => {
  const pipDocument = document.implementation.createHTMLDocument('PiP');
  const win = { document: pipDocument, addEventListener: vi.fn(), close: vi.fn(), closed: false };
  const requestWindow = vi.fn(async () => win);
  vi.stubGlobal('documentPictureInPicture', { requestWindow });
  render(<ConversationMode active fontSize={32} isDark translate={vi.fn(async () => 'Hola clase')}
    selectedLangs={['es']} mtPreference="auto" onExit={vi.fn()} onPermissionDenied={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /^Lecture$/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Show all controls' }));
  const pop = screen.getByRole('button', { name: 'Pop out lecture' });

  fireEvent.change(screen.getByLabelText('Lecture line text'), { target: { value: 'Hello class' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await act(async () => { await vi.advanceTimersByTimeAsync(50); });

  fireEvent.click(pop);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(requestWindow).toHaveBeenCalledTimes(1);
  expect(within(pipDocument.body).getByText('Hello class')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Close pop-out' }).className).toContain('is-open');

  // Leaving Lecture mode closes the floating window
  fireEvent.click(screen.getByRole('button', { name: 'Two-way' }));
  expect(win.close).toHaveBeenCalled();
});

it('clears "While I talk" when Read aloud is turned off, instead of leaving it greyed out and ticked', () => {
  render(<ConversationMode active fontSize={32} isDark translate={vi.fn(async () => '')}
    selectedLangs={['es']} mtPreference="auto" onExit={vi.fn()} onPermissionDenied={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /^Lecture$/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Show all controls' }));
  const readAloud = screen.getByRole('checkbox', { name: 'Read aloud' });
  const live = screen.getByRole('checkbox', { name: 'While I talk (headphones)' }) as HTMLInputElement;
  fireEvent.click(readAloud);
  fireEvent.click(live);
  expect(live.checked).toBe(true);

  fireEvent.click(readAloud);
  expect(live.disabled).toBe(true);
  expect(live.checked).toBe(false);
  expect(JSON.parse(localStorage.getItem('overheard.conversation')!).lectureLiveReadAloud).toBe(false);

  // Turning Read aloud back on doesn't silently turn "While I talk" back on
  fireEvent.click(readAloud);
  expect(live.checked).toBe(false);
});
