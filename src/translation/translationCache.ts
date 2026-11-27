// Each translator supplies its own cache keys and limit. Pending requests and successful
// translations occupy the same FIFO entry so concurrent callers share the original promise.
export function createTranslationCache(limit: number) {
  const entries = new Map<string, Promise<string>>();
  return {
    get(key: string) {
      return entries.get(key);
    },
    store(key: string, request: Promise<string>) {
      entries.set(key, request);
      void request.catch(() => {
        // An evicted request can fail after another request has claimed its key.
        if (entries.get(key) === request) entries.delete(key);
      });
      if (entries.size > limit) {
        const oldest = entries.keys().next();
        if (!oldest.done) entries.delete(oldest.value);
      }
      return request;
    },
  };
}
