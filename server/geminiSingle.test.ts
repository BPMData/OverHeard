import { describe, expect, it, vi } from 'vitest';
import { ThinkingLevel } from '@google/genai';
import { createGeminiSingleTranslator } from './geminiSingle';
import { createMachineTranslator } from './mt';

const setup = () => {
  const generateContent = vi.fn(async () => ({ text: '  translated  ' }));
  const translate = createGeminiSingleTranslator({
    generateContent,
    model: 'test-model',
    thinkingLevel: ThinkingLevel.LOW,
    languages: { es: 'Spanish', fr: 'French' },
  });
  return { translate, generateContent };
};

describe('Gemini single translation', () => {
  it('prompts in both directions through the provider chain, with isolated caching', async () => {
    const { translate, generateContent } = setup();
    const translator = createMachineTranslator({
      chain: ['gemini'],
      callProvider: (_provider, text, target, source) => translate(text, target, source),
    });
    await expect(translator.translate('same', 'es')).resolves.toMatchObject({
      translation: 'translated',
    });
    await translator.translate('same', 'en', undefined, 'es');
    await translator.translate('same', 'en', undefined, 'fr');
    await translator.translate('same', 'en', undefined, 'es');
    expect(generateContent).toHaveBeenCalledTimes(3);
    const requests = generateContent.mock.calls as unknown as Array<
      [{ contents: string; model: string; config: unknown }]
    >;
    expect(requests.map(([request]) => request.contents)).toEqual([
      'Translate from English into Spanish. Output only the translation.\n\nsame',
      'Translate from Spanish into English. Output only the translation.\n\nsame',
      'Translate from French into English. Output only the translation.\n\nsame',
    ]);
    expect(requests[0][0]).toMatchObject({
      model: 'test-model',
      config: { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
    });
  });

  it('rejects empty output and propagates SDK failures', async () => {
    const { translate, generateContent } = setup();
    generateContent.mockResolvedValueOnce({ text: '   ' });
    await expect(translate('hello', 'es')).rejects.toThrow('Gemini returned no text');
    generateContent.mockRejectedValueOnce(new Error('quota'));
    await expect(translate('hola', 'en', 'es')).rejects.toThrow('quota');
  });
});
