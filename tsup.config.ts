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
    // Binario único §1.7 más los dos alias deprecados.
    entry: [
      'src/cli/main.ts',
      'src/cli/legacy-encrypt.ts',
      'src/cli/legacy-decrypt.ts',
    ],
    format: ['esm'],
    target: 'es2022',
    banner: { js: '#!/usr/bin/env node' },
    clean: false,
  },
]);
