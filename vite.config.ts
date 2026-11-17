import { defineConfig } from 'vite';

// Relative base so the production build works from file:// and inside Lively Wallpaper.
export default defineConfig({
  base: './',
  server: { port: 5173, host: '127.0.0.1' },
  build: {
    target: 'es2020',
    outDir: 'dist',
    chunkSizeWarningLimit: 1500,
    sourcemap: false,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
} as any);
