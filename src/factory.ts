import type { SecretLoader, SourceContext } from './types.js';
import { DotEnvLoader } from './loaders/dotenv.js';
import { GCPSecretLoader } from './loaders/gcp.js';

export interface LoaderFactoryContext
  extends Pick<SourceContext, 'secretOrigin' | 'gcpProjectId' | 'dotenvPath'> {}

const loaderCache = new Map<string, SecretLoader>();

export function createLoader(context: LoaderFactoryContext): SecretLoader {
  const { secretOrigin, gcpProjectId, dotenvPath } = context;
  const normalizedOrigin = (secretOrigin ?? '').toLowerCase();
  const cacheKey = `${normalizedOrigin}:${gcpProjectId ?? ''}:${dotenvPath ?? ''}`;

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
    loader = new GCPSecretLoader(gcpProjectId);
  } else {
    throw new Error(`createLoader: unsupported origin '${secretOrigin}'`);
  }

  loaderCache.set(cacheKey, loader);
  return loader;
}

export function _resetLoaderCache(): void {
  loaderCache.clear();
}
