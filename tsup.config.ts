import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    target: 'es2022',
    clean: true,
    sourcemap: true,
  },
  {
    entry: ['src/cli/encrypt.ts'],
    format: ['esm'],
    target: 'es2022',
    banner: { js: '#!/usr/bin/env node' },
    clean: false,
  },
  {
    entry: ['src/cli/decrypt.ts'],
    format: ['esm'],
    target: 'es2022',
    banner: { js: '#!/usr/bin/env node' },
    clean: false,
  },
]);
