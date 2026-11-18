import path from 'node:path';
import type { Express, Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';

export async function configureDevelopment(app: Express, rootPath: string) {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  const ortNodeModules = path.join(rootPath, 'node_modules/onnxruntime-web/dist');
  const piperNodeModules = path.join(rootPath, 'node_modules/@diffusionstudio/piper-wasm/build');
  app.get('/ort/ort-wasm-simd-threaded.jsep.mjs', (_req: Request, res: Response) =>
    res.sendFile(path.join(ortNodeModules, 'ort-wasm-simd-threaded.jsep.mjs'))
  );
  app.get('/ort/ort-wasm-simd-threaded.jsep.wasm', (_req: Request, res: Response) =>
    res.sendFile(path.join(ortNodeModules, 'ort-wasm-simd-threaded.jsep.wasm'))
  );
  app.get('/piper/piper_phonemize.wasm', (_req: Request, res: Response) =>
    res.sendFile(path.join(piperNodeModules, 'piper_phonemize.wasm'))
  );
  app.get('/piper/piper_phonemize.data', (_req: Request, res: Response) =>
    res.sendFile(path.join(piperNodeModules, 'piper_phonemize.data'))
  );
  app.use(vite.middlewares);
}
