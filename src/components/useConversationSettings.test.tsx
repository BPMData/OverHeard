// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A fresh module per test, so storage that one test blocks stays blocked only there
const load = () => import('./useConversationSettings');

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('shared conversation settings', () => {
  it('shows one change in every screen that uses the settings, and saves it', async () => {
    const { useConversationSettings } = await load();
    const first = renderHook(() => useConversationSettings('es'));
    const second = renderHook(() => useConversationSettings('es'));
    expect(first.result.current[0]).toBe(second.result.current[0]);

    act(() => first.result.current[1]((s) => ({ ...s, alwaysShowAllLectureControls: true })));
    expect(second.result.current[0].alwaysShowAllLectureControls).toBe(true);
    expect(JSON.parse(localStorage.getItem('overheard.conversation')!).alwaysShowAllLectureControls).toBe(true);
  });

  it('picks up settings saved by code outside the hook and by other tabs', async () => {
    const { useConversationSettings, updateConversationSettings } = await load();
    const { result } = renderHook(() => useConversationSettings('es'));
    act(() => updateConversationSettings((s) => ({ ...s, mode: 'lecture' })));
    expect(result.current[0].mode).toBe('lecture');

    const fromOtherTab = JSON.stringify({ ...result.current[0], readAloud: true });
    localStorage.setItem('overheard.conversation', fromOtherTab);
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'overheard.conversation' }));
    });
    expect(result.current[0].readAloud).toBe(true);
  });

  it('uses the student language as a default only until something is saved', async () => {
    const { getConversationSettings, updateConversationSettings } = await load();
    expect(getConversationSettings('ar').b.lang).toBe('ar');
    expect(getConversationSettings('ar')).toBe(getConversationSettings('ar'));
    updateConversationSettings((s) => ({ ...s, manualTurns: true }), 'ar');
    expect(getConversationSettings('fr').b.lang).toBe('ar');
  });

  it('keeps working in memory when storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { useConversationSettings } = await load();
    const { result } = renderHook(() => useConversationSettings('es'));
    act(() => result.current[1]((s) => ({ ...s, alwaysShowAllLectureControls: true })));
    expect(result.current[0].alwaysShowAllLectureControls).toBe(true);
  });

  it('lets the main page Settings change a Lecture screen that is already open', async () => {
    const [{ ConversationMode }, { LectureControlsSetting }] = await Promise.all([
      import('./ConversationMode'),
      import('./LectureControlsSetting'),
    ]);
    render(
      <>
        <ConversationMode
          active
          fontSize={32}
          isDark
          translate={vi.fn()}
          selectedLangs={['es']}
          mtPreference="auto"
          onExit={vi.fn()}
          onPermissionDenied={vi.fn()}
        />
        <LectureControlsSetting initialLanguage="es" />
      </>
    );
    fireEvent.click(screen.getByRole('button', { name: /^Lecture$/ }));
    expect(screen.getByRole('button', { name: 'Show all controls' })).toBeTruthy();

    fireEvent.click(screen.getByRole('checkbox', { name: /Always show all lecture controls/ }));
    expect(screen.queryByRole('button', { name: 'Show all controls' })).toBeNull();
    expect(screen.getByRole('group', { name: 'Additional lecture controls' })).toBeTruthy();
  });
});
