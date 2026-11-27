// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StorageManager } from './StorageManager';
import { notifyStorageChanged, type StorageCategory, type StoredItem } from '../storage/registry';

const MB = 1024 * 1024;

function voices(initial: StoredItem[]) {
  let items = [...initial];
  const removeItem = vi.fn(async (id: string) => {
    items = items.filter((item) => item.id !== id);
  });
  const removeAll = vi.fn(async () => {
    items = [];
  });
  const category: StorageCategory = {
    id: 'voices',
    title: 'Downloaded voices',
    description: 'Reader voices saved on this device.',
    removeAllLabel: 'delete all downloaded voices',
    afterRemoveNote: 'Read-aloud will need to download each voice again.',
    afterRemoveItemNote: 'Read-aloud will need to download it again.',
    list: async () => items,
    removeItem,
    removeAll,
  };
  return { category, removeItem, removeAll, add: (item: StoredItem) => items.push(item) };
}

const packs: StorageCategory = {
  id: 'packs',
  title: 'Chrome language packs',
  description: 'Packs Chrome keeps.',
  cannotRemoveNote: 'Chrome doesn’t let websites delete these packs. Open chrome://on-device-translation-internals.',
  list: async () => [{ id: 'es', label: 'English ↔ Spanish', bytes: null, removable: false }],
};

const spanish = { id: 'es_MX-claude-high', label: 'Spanish · Claude', bytes: 60 * MB, removable: true };
const engine = { id: 'runtime', label: 'Voice engine', bytes: 40 * MB, removable: true };

afterEach(() => cleanup());

describe('StorageManager', () => {
  it('shows a running tally per item, per kind and in total', async () => {
    const { category } = voices([spanish, engine]);
    render(<StorageManager isDark={false} categories={[category, packs]} />);
    expect(await screen.findByText('60 MB')).toBeTruthy();
    expect(screen.getByTestId('storage-total-voices').textContent).toBe('100 MB');
    expect(screen.getByText(/take up/).textContent).toContain('100 MB');
    expect(screen.getByText(/take up/).textContent).toContain('Chrome language packs (size not reported)');
    expect(screen.getByTestId('storage-total-packs').textContent).toBe('1 installed');
    expect(screen.getByText('size not reported')).toBeTruthy();
  });

  it('asks before deleting all voices, saying how much is freed and that they must download again', async () => {
    const { category, removeAll } = voices([spanish, engine]);
    const onChanged = vi.fn();
    render(<StorageManager isDark categories={[category]} onChanged={onChanged} />);

    fireEvent.click(
      await screen.findByRole('button', { name: /Free up space: delete all downloaded voices \(100 MB\)/ })
    );
    const dialog = screen.getByRole('alertdialog', { name: 'Delete all downloaded voices?' });
    expect(dialog.textContent).toContain('This frees 100 MB on this device');
    expect(dialog.textContent).toContain('They will be gone from this device.');
    expect(dialog.textContent).toContain('download each voice again');
    expect(removeAll).not.toHaveBeenCalled();

    // Cancel keeps everything
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(removeAll).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Free up space/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete and free 100 MB' }));
    expect(await screen.findByText('Done. Freed 100 MB.')).toBeTruthy();
    expect(removeAll).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalled();
    expect(screen.getByTestId('storage-total-voices').textContent).toBe('None');
    expect(screen.getByText('Nothing is downloaded yet.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Free up space/ })).toBeNull();
  });

  it('deletes one voice after confirming', async () => {
    const { category, removeItem } = voices([spanish, engine]);
    render(<StorageManager isDark={false} categories={[category]} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Spanish · Claude' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete Spanish · Claude?' });
    expect(dialog.textContent).toContain('This frees 60 MB');
    expect(dialog.textContent).toContain(
      'It will be gone from this device. Read-aloud will need to download it again.'
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Yes, delete and free 60 MB' }));
    expect(await screen.findByText('Deleted Spanish · Claude. Freed 60 MB.')).toBeTruthy();
    expect(removeItem).toHaveBeenCalledWith('es_MX-claude-high');
    expect(screen.queryByRole('button', { name: 'Delete Spanish · Claude' })).toBeNull();
    expect(screen.getByTestId('storage-total-voices').textContent).toBe('40 MB');
  });

  it('explains packs the app cannot delete instead of offering a delete button', async () => {
    render(<StorageManager isDark={false} categories={[packs]} />);
    expect(await screen.findByText(/Chrome doesn’t let websites delete these packs/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Delete|Free up space/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy Chrome address' })).toBeTruthy();
  });

  it('measures again when a download finishes', async () => {
    const { category, add } = voices([]);
    render(<StorageManager isDark={false} categories={[category]} />);
    expect(await screen.findByText('Nothing is downloaded yet.')).toBeTruthy();
    add(spanish);
    await act(async () => notifyStorageChanged());
    expect(await screen.findByTestId('storage-total-voices')).toBeTruthy();
    expect(screen.getByTestId('storage-total-voices').textContent).toBe('60 MB');
  });
});

describe('StorageManager with a slow check', () => {
  it('shows the kinds that are measured while another is still checking', async () => {
    const { category } = voices([spanish]);
    const slow: StorageCategory = { ...packs, id: 'slow', list: () => new Promise(() => undefined) };
    render(<StorageManager isDark={false} categories={[category, slow]} />);
    expect(await screen.findByText('Spanish · Claude')).toBeTruthy();
    expect(screen.getByTestId('storage-total-voices').textContent).toBe('60 MB');
    expect(screen.getByTestId('storage-total-slow').textContent).toBe('…');
    expect(screen.getByText(/take up/).textContent).toContain('60 MB');
  });
});
