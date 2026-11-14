/** The server asked us to slow down (HTTP 429). Retrying straight away would only add load. */
export class RateLimitedError extends Error {
  constructor() {
    super('HTTP 429');
  }
}
