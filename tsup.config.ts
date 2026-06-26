import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
    index: 'src/index.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  onSuccess: 'cp src/server/viewer.html dist/ 2>/dev/null || true && cp src/server/viewer-app.js dist/ 2>/dev/null || true && cp -r src/server/viewer dist/ 2>/dev/null || true',
});
