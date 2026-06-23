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
  external: [
    'tree-sitter',
    'tree-sitter-javascript',
    'tree-sitter-typescript',
    'tree-sitter-java',
    'tree-sitter-kotlin',
    'tree-sitter-scala',
    'tree-sitter-python',
    'tree-sitter-go',
    'tree-sitter-rust',
    'better-sqlite3',
  ],
  onSuccess: 'cp src/server/viewer.html dist/ 2>/dev/null || true && cp src/server/projects.html dist/ 2>/dev/null || true && cp src/server/viewer-app.js dist/ 2>/dev/null || true && cp -r src/server/viewer dist/ 2>/dev/null || true',
});
