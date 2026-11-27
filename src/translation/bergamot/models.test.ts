import { describe, expect, it } from 'vitest';
import { VALID_LANGUAGE_CODES } from '../../constants';
import {
  BERGAMOT_APPROXIMATE,
  BERGAMOT_BASE_URL,
  BERGAMOT_MODELS,
  bergamotDownloadLabel,
  bergamotModelFor,
  maxNewTokens,
  modelBytes,
  modelFileUrl,
  ON_DEVICE_MODELS,
  OPUS_BASE_URL,
  OPUS_MODELS,
} from './models';

describe('Bergamot model catalog', () => {
  it('covers Urdu, Dari and the languages with Mozilla models, and nothing OverHeard lacks', () => {
    const langs = BERGAMOT_MODELS.map((m) => m.lang).sort();
    expect(langs).toEqual(['ar', 'bn', 'es', 'fr', 'hi', 'id', 'ja', 'prs', 'pt', 'ru', 'tr', 'uk', 'ur', 'vi', 'zh']);
    for (const lang of langs) expect(VALID_LANGUAGE_CODES.has(lang)).toBe(true);
    // No small model good enough yet for these; Swahili uses Opus-MT instead (below)
    for (const lang of ['ht', 'so', 'ps']) expect(bergamotModelFor(lang)).toBeNull();
    expect(BERGAMOT_MODELS.some((m) => m.lang === 'sw')).toBe(false);
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
    for (const model of ON_DEVICE_MODELS) {
      for (const file of model.files) expect(modelFileUrl(model, file).toLowerCase()).not.toContain('ai');
    }
    expect(BERGAMOT_BASE_URL).toMatch(/^https:\/\/bpmdata\.github\.io\//);
  });

  it('labels download sizes for the button', () => {
    expect(bergamotDownloadLabel('ur')).toBe('34 MB');
    expect(bergamotDownloadLabel('prs')).toBe('21 MB');
    expect(bergamotDownloadLabel('sw')).toBe('132 MB');
    expect(bergamotDownloadLabel('ht')).toBe('');
  });
});

describe('Opus-MT (Swahili)', () => {
  it('runs Swahili with Opus-MT from its own Pages site', () => {
    const model = bergamotModelFor('sw')!;
    expect(model.engine).toBe('opus');
    expect(OPUS_MODELS).toContain(model);
    expect(OPUS_BASE_URL).toBe('https://bpmdata.github.io/overheard-translation-models');
    expect(modelFileUrl(model, model.files[4])).toBe(
      'https://bpmdata.github.io/overheard-translation-models/opus-mt-en-sw/onnx/encoder_model_quantized.onnx'
    );
    expect(bergamotModelFor('sw', 'es')).toBeNull();
  });

  it('lists every file Transformers.js loads, with exact sizes and hashes', () => {
    const model = bergamotModelFor('sw')!;
    expect(model.files.map((f) => f.path.replace('opus-mt-en-sw/', '')).sort()).toEqual([
      'config.json',
      'generation_config.json',
      'onnx/decoder_model_merged_quantized.onnx',
      'onnx/encoder_model_quantized.onnx',
      'tokenizer.json',
      'tokenizer_config.json',
    ]);
    for (const file of model.files) expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(modelBytes(model)).toBe(138422157);
  });

  it('caps generated tokens by sentence length', () => {
    expect(maxNewTokens('Please open your books.')).toBe(32);
    expect(maxNewTokens('word '.repeat(500))).toBe(256);
  });
});
