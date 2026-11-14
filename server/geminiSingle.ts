import type { GenerateContentParameters, ThinkingLevel } from '@google/genai';

interface GeminiSingleOptions {
  generateContent: (request: GenerateContentParameters) => Promise<{ text?: string }>;
  model: string;
  thinkingLevel: ThinkingLevel;
  languages: Readonly<Record<string, string>>;
}

/** Single-message translation, kept separate from English-only caption refinement. */
export function createGeminiSingleTranslator({
  generateContent,
  model,
  thinkingLevel,
  languages,
}: GeminiSingleOptions) {
  const languageName = (code: string) => (code === 'en' ? 'English' : languages[code]);
  return async (text: string, target: string, source = 'en'): Promise<string> => {
    const response = await generateContent({
      model,
      contents: `Translate from ${languageName(source)} into ${languageName(target)}. Output only the translation.\n\n${text}`,
      config: {
        systemInstruction:
          'You are a classroom interpreter. Natural, student-friendly, keep subject vocabulary accurate.',
        thinkingConfig: { thinkingLevel },
      },
    });
    const out = (response.text ?? '').trim();
    if (!out) throw new Error('Gemini returned no text');
    return out;
  };
}
