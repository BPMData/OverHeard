import { describe, expect, it, vi } from 'vitest';
import { splitTranslationChunks, translateConversationMessage } from './translateMessage';

describe('conversation message translation', () => {
  it('keeps a short message in one request and preserves both languages', async () => {
    const translate = vi.fn(async () => 'Hello');
    await expect(translateConversationMessage('Hola', 'en', 'es', translate)).resolves.toBe(
      'Hello',
    );
    expect(translate).toHaveBeenCalledExactlyOnceWith('Hola', 'en', 'es');
  });

  it('translates an entire long paragraph in bounded ordered requests', async () => {
    const original = Array.from({ length: 220 }, (_, i) => `word${i}`).join(' ');
    let active = 0;
    const translate = vi.fn(async (text: string) => {
      expect(++active).toBe(1);
      await Promise.resolve();
      active--;
      return text;
    });
    await expect(translateConversationMessage(original, 'es', 'en', translate)).resolves.toBe(
      original,
    );
    expect(translate.mock.calls.length).toBeGreaterThan(1);
    expect(translate.mock.calls.every(([chunk]) => chunk.length <= 500)).toBe(true);
  });

  it('does not lose text or cut surrogate pairs in long unspaced speech', () => {
    const original = 'a' + '😀'.repeat(600);
    const chunks = splitTranslationChunks(original);
    expect(chunks.join('')).toBe(original);
    expect(chunks.every((chunk) => chunk.length <= 500)).toBe(true);
    expect(chunks.every((chunk) => !/[\uD800-\uDBFF]$/u.test(chunk))).toBe(true);
    expect(chunks.every((chunk) => !/^[\uDC00-\uDFFF]/u.test(chunk))).toBe(true);
  });

  it('returns equal-language messages verbatim without translation', async () => {
    const translate = vi.fn();
    const original = '  ' + 'hello '.repeat(200);
    await expect(translateConversationMessage(original, 'en', 'en', translate)).resolves.toBe(
      original,
    );
    expect(translate).not.toHaveBeenCalled();
  });

  it('rejects on a failed chunk instead of returning an incomplete translation', async () => {
    const translate = vi
      .fn()
      .mockResolvedValueOnce('first')
      .mockRejectedValueOnce(new Error('offline'));
    await expect(
      translateConversationMessage('hello '.repeat(200), 'es', 'en', translate),
    ).rejects.toThrow('offline');
    expect(translate).toHaveBeenCalledTimes(2);
  });
});
