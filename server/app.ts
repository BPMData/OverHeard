import path from 'node:path';
import express from 'express';
import type { Request, Response } from 'express';
import { createRoomRouter } from './rooms.ts';
import { registerMtRoutes } from './routes/mt.ts';
import type { MtRouteOptions } from './routes/mt.ts';
import { registerReportRoutes } from './report.ts';
import type { ReportRouteOptions } from './report.ts';

interface CreateAppOptions {
  trustProxyHops: number;
  mt: MtRouteOptions;
  report: ReportRouteOptions;
  distPath?: string;
}

export function createApp({ trustProxyHops, mt, report, distPath }: CreateAppOptions) {
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
  // Before the shared 16 kB body limit: a report in another script can be larger than that.
  const closeReports = registerReportRoutes(app, report);
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
    // A build file that isn't here (an old hash from before a deploy) is a real 404, not the
    // page: answering CSS/JS requests with index.html gets it refused as a stylesheet or script
    // and lets the service worker save the page under the asset's name.
    app.get(['/assets/*', '/ort/*', '/piper/*', '/bergamot/*', '/sw.js'], (_req: Request, res: Response) => {
      res.status(404).type('text/plain').send('Not found');
    });
    app.get('*', (_req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  return {
    app,
    close() {
      closeMt();
      closeReports();
      rooms.close();
    },
  };
}
