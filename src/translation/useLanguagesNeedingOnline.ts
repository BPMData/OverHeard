import { useEffect, useState } from 'react';
import { ON_DEVICE_TIMEOUT_MS, rejectAfter } from '../app/settings';
import { LANGUAGE_MAP } from '../constants';
import { getOnDeviceAvailability, hasOnDeviceWorked, onOnDeviceWorkedChange } from '../onDevice';
import type { ConversationLanguage, LanguageCode } from '../types';
import { hasBergamotModel } from './bergamot/engine';

export interface LanguagePair {
  source: ConversationLanguage;
  target: ConversationLanguage;
}

/** English to each language: what lecture captions translate. */
export const fromEnglish = (langs: readonly LanguageCode[]): LanguagePair[] =>
  langs.map((target) => ({ source: 'en', target }));

/** Both directions of a two-way conversation. */
export const bothWays = (a: ConversationLanguage, b: ConversationLanguage): LanguagePair[] =>
  a === b
    ? []
    : [
        { source: a, target: b },
        { source: b, target: a },
      ];

/**
 * Languages that "Only on this device" can't translate here, so the page can say why their
 * captions stay untranslated. A pair names its non-English language (the target when neither is
 * English). Chrome's check can hang in a browser without its translation service; then only a
 * pair with a downloadable pack counts as translatable. A pair that has already translated on
 * this device always counts: Chrome's check misreports while offline.
 */
export function useLanguagesNeedingOnline(pairs: readonly LanguagePair[], active: boolean): LanguageCode[] {
  const [missing, setMissing] = useState<LanguageCode[]>([]);
  // Bumped when a pair is found working (or missing), so a stale warning clears at once
  const [workedVersion, setWorkedVersion] = useState(0);
  useEffect(() => onOnDeviceWorkedChange(() => setWorkedVersion((v) => v + 1)), []);
  const key = pairs.map((p) => p.source + '>' + p.target).join(',');
  useEffect(() => {
    if (!active || pairs.length === 0) {
      setMissing([]);
      return;
    }
    let cancelled = false;
    void Promise.all(
      pairs.map(({ source, target }) => {
        const named = (target === 'en' ? source : target) as LanguageCode;
        return rejectAfter(getOnDeviceAvailability(target, source), ON_DEVICE_TIMEOUT_MS).then(
          (status) => (status === 'unavailable' ? named : null),
          () => (hasBergamotModel(target, source) || hasOnDeviceWorked(target, source) ? null : named)
        );
      })
    ).then((results) => {
      if (cancelled) return;
      const found = results.filter((lang): lang is LanguageCode => lang !== null && lang in LANGUAGE_MAP);
      setMissing([...new Set(found)]);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for `pairs`
  }, [key, active, workedVersion]);
  return missing;
}

/** What a teacher's untranslated language means for students in a live room. */
export const STUDENTS_STILL_TRANSLATE =
  'Students in a live room still get these translations on their own devices, online, unless they chose Only on this device.';

/**
 * "⚠ Haitian Creole, Pashto: need online translation" and its longer explanation. `rooms`: the
 * page can host a live student room, so say what students get.
 */
export function needOnlineText(
  langs: readonly LanguageCode[],
  { rooms = false }: { rooms?: boolean } = {}
): { names: string; label: string; title: string } {
  const names = langs.map((lang) => LANGUAGE_MAP[lang].name).join(', ');
  const many = langs.length > 1;
  return {
    names,
    label: `⚠ ${names}: ${many ? 'need' : 'needs'} online translation`,
    title:
      `${names} can’t be translated on this device alone, so ${many ? 'they stay' : 'it stays'} untranslated on this screen. ` +
      `Choose On-device first or an online translator to translate ${many ? 'them' : 'it'}.` +
      (rooms ? ' ' + STUDENTS_STILL_TRANSLATE : ''),
  };
}
