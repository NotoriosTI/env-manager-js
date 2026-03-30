import { afterEach, beforeEach } from 'vitest';
import { _resetSingleton } from '../src/manager.js';

// Env vars to clean up before each test.
// Source: Python conftest.py `clear_env` fixture + APP_ENV (used in TS port).
const ENV_KEYS_TO_CLEAN = [
  'DB_PASSWORD',
  'PORT',
  'DEBUG_MODE',
  'TIMEOUT',
  'GCP_PROJECT_ID',
  'SECRET_ORIGIN',
  'API_KEY',
  'OPTIONAL',
  'WORKERS',
  'ENVIRONMENT',   // kept from Python conftest even though TS uses APP_ENV
  'APP_ENV',       // TS port uses APP_ENV to select active environment
  'DEFAULT_TOKEN',
  'OVERRIDE_TOKEN',
  'PINNED_SECRET',
  'GCP_SECRET',
  'SHARED_TOKEN',
  'OVERRIDDEN_TOKEN',
  'LOCAL_ONLY_TOKEN',
  'OPTIONAL_TOKEN',
  'API_TOKEN',
  'PROD_LOCAL_TOKEN',
];

beforeEach(() => {
  _resetSingleton();
  for (const key of ENV_KEYS_TO_CLEAN) {
    delete process.env[key];
  }
});

afterEach(() => {
  _resetSingleton();
  vi.unstubAllEnvs();
});
