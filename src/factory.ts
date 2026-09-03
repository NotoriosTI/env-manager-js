import type { SecretLoader, SourceContext } from './types.js';
import { DotEnvLoader } from './loaders/dotenv.js';
import { GCPSecretLoader } from './loaders/gcp.js';
import { ORIGIN_ALIASES } from './environment.js';

export interface LoaderFactoryContext
  extends Pick<
    SourceContext,
    | 'secretOrigin'
    | 'gcpProjectId'
    | 'dotenvPath'
    | 'consolidatedSecret'
  > {
  fallbackToIndividual?: boolean;
}

const loaderCache = new Map<string, SecretLoader>();

export function createLoader(context: LoaderFactoryContext): SecretLoader {
  const {
    secretOrigin,
    gcpProjectId,
    dotenvPath,
    consolidatedSecret,
    fallbackToIndividual = true,
  } = context;
  const rawOrigin = (secretOrigin ?? '').toLowerCase();
  const normalizedOrigin = ORIGIN_ALIASES[rawOrigin] ?? rawOrigin;
  if (typeof fallbackToIndividual !== 'boolean') {
    throw new Error('createLoader: fallbackToIndividual must be a boolean');
  }
  if (!fallbackToIndividual && !consolidatedSecret) {
    throw new Error(
      'createLoader: fallbackToIndividual cannot be false without consolidatedSecret',
    );
  }
  const cacheKey =
    `${normalizedOrigin}:${gcpProjectId ?? ''}:${dotenvPath ?? ''}:` +
    `${consolidatedSecret ?? ''}:${String(fallbackToIndividual)}`;

  if (loaderCache.has(cacheKey)) {
    return loaderCache.get(cacheKey) as SecretLoader;
  }

  let loader: SecretLoader;

  if (normalizedOrigin === 'local') {
    loader = new DotEnvLoader(dotenvPath);
  } else if (normalizedOrigin === 'gcp') {
    if (!gcpProjectId) {
      throw new Error('createLoader: gcpProjectId is required for gcp origin');
    }
    loader = new GCPSecretLoader(gcpProjectId, {
      consolidatedSecret,
      fallbackToIndividual,
    });
  } else {
    throw new Error(`createLoader: unsupported origin '${secretOrigin}'`);
  }

  loaderCache.set(cacheKey, loader);
  return loader;
}

export function _resetLoaderCache(): void {
  loaderCache.clear();
}
