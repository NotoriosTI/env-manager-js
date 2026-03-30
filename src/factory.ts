import type { SecretLoader, SourceContext } from './types.js';

export interface LoaderFactoryContext
  extends Pick<SourceContext, 'secretOrigin' | 'gcpProjectId' | 'dotenvPath'> {}

export function createLoader(context: LoaderFactoryContext): SecretLoader {
  void context;
  throw new Error('Not implemented');
}
