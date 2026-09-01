/**
 * Alias deprecado de `env-manager encrypt`.
 *
 * Se mantiene una versión para no romper a quien ya invoca
 * `env-manager-encrypt`. Avisa por stderr y delega en el dispatcher, así el
 * comportamiento y los exit codes son exactamente los mismos.
 */
import { dispatch } from './main.js';

process.stderr.write(
  "Warning: 'env-manager-encrypt' is deprecated and will be removed in the next release. " +
    "Use 'env-manager encrypt' instead.\n",
);

dispatch(['encrypt', ...process.argv.slice(2)]);
