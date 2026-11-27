import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build` -> dist/ (normal multi-file build for Vercel)
// `npm run build:single` -> dist-single/index.html (one self-contained file for review links)
export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    base: './',
    plugins: single ? [viteSingleFile()] : [],
    build: {
      outDir: single ? 'dist-single' : 'dist',
      assetsInlineLimit: single ? 100_000_000 : 4096,
      target: 'es2020',
      chunkSizeWarningLimit: 2500,
    },
  };
});
