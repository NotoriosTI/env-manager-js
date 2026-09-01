/**
 * Alias deprecado de `env-manager decrypt`. Ver `legacy-encrypt.ts`.
 */
import { dispatch } from './main.js';

process.stderr.write(
  "Warning: 'env-manager-decrypt' is deprecated and will be removed in the next release. " +
    "Use 'env-manager decrypt' instead.\n",
);

dispatch(['decrypt', ...process.argv.slice(2)]);
