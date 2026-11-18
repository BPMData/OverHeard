import path from 'node:path';
import express from 'express';
import type { Request, Response } from 'express';
import { createRoomRouter } from './rooms.ts';
import { registerMtRoutes } from './routes/mt.ts';
import type { MtRouteOptions } from './routes/mt.ts';

interface CreateAppOptions {
  trustProxyHops: number;
  mt: MtRouteOptions;
  distPath?: string;
}

export function createApp({ trustProxyHops, mt, distPath }: CreateAppOptions) {
  const app = express();
  // Trust only the proxy hops we expect in front of us (Cloud Run's front end is one)
  app.set('trust proxy', trustProxyHops);
  app.use((_req: Request, res: Response, next) => {
    // Allow Google OAuth popups and third-party iframes (such as Google Picker,
    // which returns `cross-origin-resource-policy: same-site`); Piper WASM runs
    // cleanly single-threaded without Cross-Origin-Embedder-Policy.
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    next();
  });
  const rooms = createRoomRouter();
  app.use('/api/rooms', rooms.router);
  app.use(express.json({ limit: '16kb' }));

  const closeMt = registerMtRoutes(app, mt);

  if (distPath) {
    app.use(
      express.static(distPath, {
        setHeaders: (res, filePath) => {
          if (filePath.endsWith(`${path.sep}index.html`) || filePath.endsWith(`${path.sep}sw.js`)) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      })
    );
    app.get('*', (_req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  return {
    app,
    close() {
      closeMt();
      rooms.close();
    },
  };
}
