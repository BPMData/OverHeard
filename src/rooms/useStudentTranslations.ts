import { useEffect, useMemo, useRef, useState } from 'react';
import type { LanguageCode } from '../types';
import { useLiveTranslations } from '../useLiveTranslations';
import { useDeviceFirstTranslator } from '../translation/useDeviceFirstTranslator';
import { createStudentTranslator } from './translateStudent';
import type { RoomSnapshot } from './protocol';

export function useStudentTranslations(snapshot: RoomSnapshot | null, language: LanguageCode | 'en') {
  const [translatedBy, setTranslatedBy] = useState<'on-device' | 'gtx' | null>(null);
  const tryDeviceFirst = useDeviceFirstTranslator(language);
  const translate = useMemo(() => createStudentTranslator(tryDeviceFirst, setTranslatedBy), [tryDeviceFirst]);
  const results = useRef(new Map<string, string | null>());
  const pending = useRef(new Set<string>());
  const [version, refresh] = useState(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const keyFor = (text: string) => `${language}\0${text}`;

  // Translate recent lines first, with a bounded queue for late joins and language changes.
  // A missing teacher translation is pending, not a reason to duplicate its request.
  useEffect(() => {
    if (!snapshot || language === 'en') return;
    for (const entry of [...snapshot.entries].reverse()) {
      if (pending.current.size >= 3) break;
      if (entry.translations[language] || (snapshot.teacherOnline && !snapshot.ended &&
          snapshot.selectedLangs.includes(language) && !entry.failedLangs[language])) continue;
      const key = keyFor(entry.english);
      if (results.current.has(key) || pending.current.has(key)) continue;
      pending.current.add(key);
      void translate(entry.english, language).then(
        value => results.current.set(key, value),
        error => {
          if (!(error instanceof DOMException && error.name === 'AbortError')) results.current.set(key, null);
        },
      ).finally(() => {
        pending.current.delete(key);
        if (results.current.size > 3000) results.current.delete(results.current.keys().next().value!);
        if (mounted.current) refresh(value => value + 1);
      });
    }
  }, [snapshot, language, translate, version]);

  const teacherSupplies = language !== 'en' && !!snapshot?.selectedLangs.includes(language);
  const liveLangs = useMemo<LanguageCode[]>(
    () => (language === 'en' || teacherSupplies ? [] : [language]), [language, teacherSupplies]);
  const lastEntry = snapshot?.entries[snapshot.entries.length - 1];
  const studentLive = useLiveTranslations(snapshot?.interim || '', liveLangs, translate, lastEntry?.id ?? '');

  const entries = useMemo(() => snapshot?.entries.map(entry => {
    if (language === 'en' || entry.translations[language]) return entry;
    const local = results.current.get(`${language}\0${entry.english}`);
    return { ...entry, translations: { ...entry.translations, ...(local ? { [language]: local } : {}) },
      failedLangs: { ...entry.failedLangs, [language]: local === null } };
  }) || [], [snapshot?.entries, language, version]);
  const liveText = language === 'en' ? '' : snapshot?.liveTranslations[language] ||
    studentLive[language] || '';
  return { translate, translatedBy, entries, liveTranslations: language === 'en' ? {} : { [language]: liveText },
    hasFailures: language !== 'en' && entries.some(entry => !entry.translations[language] && entry.failedLangs[language]),
    retry: () => { for (const [key, result] of results.current) if (result === null) results.current.delete(key); refresh(value => value + 1); } };
}
