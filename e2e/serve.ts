import { startServer } from '../server.ts';

process.env.NODE_ENV = 'development';
await startServer({ port: Number(process.env.E2E_PORT) || 3100 });
