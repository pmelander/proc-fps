import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      // The game, plus the seed browser (browse.html).
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        browse: fileURLToPath(new URL('./browse.html', import.meta.url)),
      },
    },
  },
  worker: { format: 'es' },
});
