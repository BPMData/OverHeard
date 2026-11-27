import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('Production Node type-stripping boot check', () => {
  it('loads server.ts and its production module graph under plain Node without tsx or vitest', async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      ['-e', "import('./server.ts').then(() => import('./server/app.ts')).then(() => console.log('OK'))"],
      {
        cwd: repoRoot,
        env: { ...process.env, NODE_ENV: 'production', NODE_OPTIONS: '' },
      }
    );
    expect(stdout.trim()).toBe('OK');
  });
});
