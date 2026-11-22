import { describe, expect, it } from 'vitest';
import { VALID_LANGUAGE_CODES } from '../../constants';
import {
  BERGAMOT_APPROXIMATE, BERGAMOT_BASE_URL, BERGAMOT_MODELS, bergamotDownloadLabel, bergamotModelFor, modelBytes,
} from './models';

describe('Bergamot model catalog', () => {
  it('covers Urdu, Dari and the languages with Mozilla models, and nothing OverHeard lacks', () => {
    const langs = BERGAMOT_MODELS.map((m) => m.lang).sort();
    expect(langs).toEqual(['ar', 'bn', 'es', 'fr', 'hi', 'id', 'ja', 'prs', 'pt', 'ru', 'tr', 'uk', 'ur', 'vi', 'zh']);
    for (const lang of langs) expect(VALID_LANGUAGE_CODES.has(lang)).toBe(true);
    // No Mozilla model yet for these
    for (const lang of ['ht', 'so', 'ps', 'sw']) expect(bergamotModelFor(lang)).toBeNull();
  });

  it('uses the Persian model for Dari and says it is approximate', () => {
    expect(bergamotModelFor('prs')?.pair).toBe('enfa');
    expect(BERGAMOT_APPROXIMATE.prs).toMatch(/Iranian Persian/);
  });

  it('only translates from English', () => {
    expect(bergamotModelFor('ur', 'es')).toBeNull();
  });

  it('has complete file entries with exact sizes and hashes', () => {
    for (const model of BERGAMOT_MODELS) {
      const parts = model.files.map((f) => f.part).sort();
      expect(parts.includes('model') && parts.includes('lex')).toBe(true);
      expect(parts.includes('vocab') || (parts.includes('srcvocab') && parts.includes('trgvocab'))).toBe(true);
      for (const file of model.files) {
        expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(file.bytes).toBeGreaterThan(0);
        expect(file.path.startsWith(`v1/${model.pair}/`)).toBe(true);
      }
      expect(modelBytes(model)).toBeLessThan(60 * 1024 * 1024);
    }
  });

  it('never puts "ai" in a download URL (school Wi-Fi blocks those)', () => {
    for (const model of BERGAMOT_MODELS) {
      for (const file of model.files) expect(`${BERGAMOT_BASE_URL}/${file.path}`.toLowerCase()).not.toContain('ai');
    }
  });

  it('labels download sizes for the button', () => {
    expect(bergamotDownloadLabel('ur')).toBe('34 MB');
    expect(bergamotDownloadLabel('prs')).toBe('21 MB');
    expect(bergamotDownloadLabel('sw')).toBe('');
  });
});
