/**
 * Timeout y taxonomía de errores del loader de GCP (blueprint §1.5.3, §1.5.4).
 * Espejo de tests/test_gcp_timeout.py en el repo Python.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_GCP_TIMEOUT,
  DETERMINISTIC_CODES,
  GCPSecretLoader,
  MAX_RETRY_ATTEMPTS,
  TRANSIENT_CODES,
  isTransient,
  resolveTimeout,
} from '../src/loaders/gcp.js';

function grpcError(code: number, message = 'boom'): Error & { code: number } {
  const error = new Error(message) as Error & { code: number };
  error.code = code;
  return error;
}

function payload(value: string) {
  return [{ payload: { data: Buffer.from(value, 'utf-8') } }] as [
    { payload: { data: Buffer } },
  ];
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('resolución del timeout', () => {
  it('usa el default cuando no hay nada', () => {
    vi.stubEnv('ENV_MANAGER_GCP_TIMEOUT', '');
    expect(resolveTimeout(undefined)).toBe(DEFAULT_GCP_TIMEOUT);
  });

  it('el argumento explícito gana sobre la env var', () => {
    vi.stubEnv('ENV_MANAGER_GCP_TIMEOUT', '99');
    expect(resolveTimeout(2.5)).toBe(2.5);
  });

  it('usa la env var cuando no hay argumento', () => {
    vi.stubEnv('ENV_MANAGER_GCP_TIMEOUT', '3.5');
    expect(resolveTimeout(undefined)).toBe(3.5);
  });

  it.each(['abc', '0', '-1'])('env var inválida (%s) cae al default', (raw) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('ENV_MANAGER_GCP_TIMEOUT', raw);
    expect(resolveTimeout(undefined)).toBe(DEFAULT_GCP_TIMEOUT);
  });

  it('el loader expone su timeout', () => {
    vi.stubEnv('ENV_MANAGER_GCP_TIMEOUT', '');
    const loader = new GCPSecretLoader('proj', {
      createClient: () => ({ accessSecretVersion: vi.fn() }),
    });
    expect(loader.timeout).toBe(DEFAULT_GCP_TIMEOUT);
  });
});

describe('taxonomía de errores', () => {
  it.each([...TRANSIENT_CODES])('el código %i es transitorio', (code) => {
    expect(isTransient(grpcError(code))).toBe(true);
  });

  it.each([...DETERMINISTIC_CODES, 5])('el código %i no es transitorio', (code) => {
    expect(isTransient(grpcError(code))).toBe(false);
  });
});

describe('llamadas a Secret Manager', () => {
  it('toda llamada lleva el timeout, en milisegundos', async () => {
    vi.stubEnv('ENV_MANAGER_GCP_TIMEOUT', '');
    const accessSecretVersion = vi.fn().mockResolvedValue(payload('value'));
    const loader = new GCPSecretLoader('proj', { createClient: () => ({ accessSecretVersion }) });

    await expect(loader.get('KEY')).resolves.toBe('value');

    expect(accessSecretVersion).toHaveBeenCalledWith(
      { name: 'projects/proj/secrets/KEY/versions/latest' },
      { timeout: DEFAULT_GCP_TIMEOUT * 1000 },
    );
  });

  it('NOT_FOUND devuelve null y avisa', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const accessSecretVersion = vi.fn().mockRejectedValue(grpcError(5));
    const loader = new GCPSecretLoader('proj', { createClient: () => ({ accessSecretVersion }) });

    await expect(loader.get('KEY')).resolves.toBeNull();
    expect(accessSecretVersion).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });

  it('un error determinista no se reintenta y dice que reintentar no ayuda', async () => {
    const accessSecretVersion = vi.fn().mockRejectedValue(grpcError(7, 'denied'));
    const loader = new GCPSecretLoader('proj', { createClient: () => ({ accessSecretVersion }) });

    await expect(loader.get('KEY')).rejects.toThrow(/Retrying will not help/);
    expect(accessSecretVersion).toHaveBeenCalledTimes(1);
  });

  it('un error transitorio se reintenta hasta el tope y luego falla', async () => {
    const accessSecretVersion = vi.fn().mockRejectedValue(grpcError(14, 'unavailable'));
    const loader = new GCPSecretLoader('proj', {
      createClient: () => ({ accessSecretVersion }),
      retryBaseDelayMs: 0,
    });

    await expect(loader.get('KEY')).rejects.toThrow(
      new RegExp(`Retries exhausted after ${MAX_RETRY_ATTEMPTS} attempts`),
    );
    expect(accessSecretVersion).toHaveBeenCalledTimes(MAX_RETRY_ATTEMPTS);
  });

  it('un transitorio que después funciona devuelve el valor', async () => {
    const accessSecretVersion = vi
      .fn()
      .mockRejectedValueOnce(grpcError(14))
      .mockResolvedValue(payload('value'));
    const loader = new GCPSecretLoader('proj', {
      createClient: () => ({ accessSecretVersion }),
      retryBaseDelayMs: 0,
    });

    await expect(loader.get('KEY')).resolves.toBe('value');
    expect(accessSecretVersion).toHaveBeenCalledTimes(2);
  });

  it('un error sin código reconocible se propaga tal cual', async () => {
    const boom = new Error('socket exploded');
    const accessSecretVersion = vi.fn().mockRejectedValue(boom);
    const loader = new GCPSecretLoader('proj', { createClient: () => ({ accessSecretVersion }) });

    await expect(loader.get('KEY')).rejects.toBe(boom);
    expect(accessSecretVersion).toHaveBeenCalledTimes(1);
  });
});
