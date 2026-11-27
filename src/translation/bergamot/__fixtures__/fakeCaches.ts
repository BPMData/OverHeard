// In-memory Cache Storage for tests (Node has none).
class FakeCache {
  readonly entries = new Map<string, Response>();
  async match(request: RequestInfo | URL) {
    const hit = this.entries.get(String(request instanceof Request ? request.url : request));
    return hit?.clone();
  }
  async put(request: RequestInfo | URL, response: Response) {
    // Read the body now, like a real cache does, so the stored copy can be cloned later
    const body = await response.arrayBuffer();
    this.entries.set(
      String(request instanceof Request ? request.url : request),
      new Response(body, { headers: response.headers })
    );
  }
  async delete(request: RequestInfo | URL) {
    return this.entries.delete(String(request instanceof Request ? request.url : request));
  }
  async keys() {
    return [...this.entries.keys()].map((url) => new Request(url));
  }
}

export class FakeCacheStorage {
  readonly caches = new Map<string, FakeCache>();
  async has(name: string) {
    return this.caches.has(name);
  }
  async open(name: string) {
    let cache = this.caches.get(name);
    if (!cache) {
      cache = new FakeCache();
      this.caches.set(name, cache);
    }
    return cache as unknown as Cache;
  }
  async delete(name: string) {
    return this.caches.delete(name);
  }
}
