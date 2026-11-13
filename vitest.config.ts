import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts so tests don't load Tailwind or the dev-server settings.
// Tests run in Node by default; UI tests opt into jsdom with a `@vitest-environment jsdom` comment.
export default defineConfig({
  plugins: [react()],
  test: {
    include: ['server/**/*.test.ts', 'src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
