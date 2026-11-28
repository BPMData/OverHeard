import { expect, test } from '@playwright/test';
import { once } from 'node:events';
import { cp, copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeServiceWorker } from '../scripts/build-offline.ts';
import { createApp } from '../server/app.ts';

test('an installed classroom app upgrades its saved runtime and reopens offline', async ({ page, context }) => {
  const dist = await mkdtemp(path.join(tmpdir(), 'overheard-upgrade-'));
  const { app, close } = createApp({
    distPath: dist,
    trustProxyHops: 0,
    mt: { mtChain: ['gtx'], mtPerSession: 10, ipLimitMultiplier: 1, cloudDailyChars: 0, shortLinkBase: null },
    report: { githubRepo: '', appVersion: 'test' },
  });
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
    await cp('dist', dist, { recursive: true });
    await page.goto(origin);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    const runtime = '/bergamot/translator-worker.js';
    const file = path.join(dist, runtime);
    const original = await readFile(file, 'utf8');
    expect(await page.evaluate(async (url) => (await fetch(url)).text(), runtime)).toBe(original);
    await page.evaluate(async () => {
      // Existing installations can also have engine files saved under the old, unversioned URL.
      const engines = await caches.open('overheard-runtime-v1');
      await engines.put('/ort/ort-wasm-simd-threaded.jsep.mjs', new Response('legacy runtime'));
      const models = await caches.open('overheard-bergamot-v1');
      await models.put('/installed-language-pack', new Response('saved model'));
      const dir = await navigator.storage.getDirectory();
      const handle = await dir.getFileHandle('saved-voice', { create: true });
      const voice = await handle.createWritable();
      await voice.write('saved voice');
      await voice.close();
    });

    // Publish a second release on the same origin using the real build manifest generator.
    const updated = original + '\n// updated classroom engine\n';
    await writeFile(file, updated);
    const index = path.join(dist, 'index.html');
    await writeFile(
      index,
      (await readFile(index, 'utf8')).replace('</head>', '<meta name="upgrade-test" content="B"></head>')
    );
    await copyFile('public/sw.js', path.join(dist, 'sw.js'));
    writeServiceWorker(dist);
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      const changed = new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true })
      );
      await registration.update();
      await changed;
    });
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('meta[name="upgrade-test"]')).toHaveAttribute('content', 'B');
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
    expect(await page.evaluate(async (url) => (await fetch(url)).text(), runtime)).toBe(updated);
    const legacyPath = '/ort/ort-wasm-simd-threaded.jsep.mjs';
    expect(await page.evaluate(async (url) => (await fetch(url)).text(), legacyPath)).toBe(
      await readFile(path.join(dist, legacyPath), 'utf8')
    );
    expect(
      await page.evaluate(async () => {
        const cache = await caches.open('overheard-bergamot-v1');
        const dir = await navigator.storage.getDirectory();
        const voice = await (await dir.getFileHandle('saved-voice')).getFile();
        return [await (await cache.match('/installed-language-pack'))?.text(), await voice.text()];
      })
    ).toEqual(['saved model', 'saved voice']);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    close();
    await rm(dist, { recursive: true, force: true });
  }
});
