import type { ConversationLanguage } from '../types';

export type TranslateText = (
  text: string,
  target: ConversationLanguage,
  source?: ConversationLanguage,
) => Promise<string>;

// /api/mt accepts at most 500 UTF-16 units. Keep each conversation request within
// that limit without changing the low-latency classroom caption path.
export const MESSAGE_CHUNK_LIMIT = 500;

export function splitTranslationChunks(text: string): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > MESSAGE_CHUNK_LIMIT) {
    let end = MESSAGE_CHUNK_LIMIT;
    // Don't separate a UTF-16 surrogate pair when a long word needs a hard cut.
    const last = remaining.charCodeAt(end - 1);
    const next = remaining.charCodeAt(end);
    if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end--;
    const candidate = remaining.slice(0, end);
    const whitespace = candidate.search(/\s+\S*$/u);
    // Avoid producing tiny chunks when one unusually long word follows a short one.
    if (whitespace >= end / 2) end = whitespace;
    chunks.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export async function translateConversationMessage(
  text: string,
  target: ConversationLanguage,
  source: ConversationLanguage,
  translate: TranslateText,
): Promise<string> {
  if (source === target) return text;
  const translated: string[] = [];
  // Sequential requests bound provider load even for a very long conversation turn.
  // Reject the entire message if a chunk fails so the UI can retain the full original.
  for (const chunk of splitTranslationChunks(text)) {
    translated.push(await translate(chunk, target, source));
  }
  return translated.join(' ');
}
