import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * OverHeard must never request sensitive or restricted Google OAuth scopes.
 * Those trigger Google's manual sensitive-scope review (restricted ones also need a paid
 * security audit), a 100-user cap and an "unverified app" screen, and school admins block them.
 * Only non-sensitive scopes are allowed here.
 */
const ALLOWED_URL_SCOPES = new Set([
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
]);
const ALLOWED_SHORT_SCOPES = new Set(['openid', 'email', 'profile']);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx|js|jsx|html)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe('Google OAuth scopes', () => {
  it('only non-sensitive scopes appear in the app code', () => {
    const files = [
      ...sourceFiles(path.join(repoRoot, 'src')),
      ...sourceFiles(path.join(repoRoot, 'server')),
      path.join(repoRoot, 'index.html'),
      path.join(repoRoot, 'server.ts'),
    ];
    const found: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      const rel = path.relative(repoRoot, f);
      for (const m of text.matchAll(/https:\/\/www\.googleapis\.com\/auth\/[\w.-]+/g)) {
        if (!ALLOWED_URL_SCOPES.has(m[0])) found.push(`${rel}: ${m[0]}`);
      }
      // Short scope names inside a `scope: '...'` string, e.g. scope: 'openid email'.
      // Ignore TypeScript union types like `scope: 'unified' | 'board'`.
      for (const m of text.matchAll(/\bscope\s*:\s*['"`]([^'"`]*)['"`](?!\s*\|)/g)) {
        for (const part of m[1].split(/\s+/).filter(Boolean)) {
          if (!part.startsWith('https://') && !ALLOWED_SHORT_SCOPES.has(part)) {
            found.push(`${rel}: scope "${part}"`);
          }
        }
      }
    }
    expect(found).toEqual([]);
  });
});
