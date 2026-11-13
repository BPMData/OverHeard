// Who a request counts against for rate limiting.
//
// Each browser tab sends a random session ID, so every teacher gets their own budget even
// when a whole school shares one public IP. Session IDs are chosen by the client and can be
// rotated freely, so a looser per-IP limit still sits behind them as the real backstop.

export const SESSION_HEADER = 'x-overheard-session';

const SESSION_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

/** The rate-limit key for a request: its session ID if valid, otherwise its IP. */
export function sessionKey(header: unknown, ip: string): string {
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === 'string' && SESSION_ID_PATTERN.test(value)
    ? `s:${value}`
    : `ip:${ip}`;
}
