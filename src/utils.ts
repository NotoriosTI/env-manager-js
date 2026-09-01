import { readFileSync } from 'fs';

import { parse } from 'yaml';

import type { VariableType } from './types.js';

/**
 * Diagnóstico de la librería.
 *
 * Blueprint §1.7: los resultados van a stdout y todo lo demás a stderr. Una
 * librería que escribe en stdout rompe a cualquier consumidor que parsee la
 * salida de su propio proceso. Paridad con el logger de Python, que no tiene
 * handler y por lo tanto tampoco toca stdout.
 */
export const logger = {
  info(message: string): void {
    console.error(message);
  },
  warn(message: string): void {
    console.warn(message);
  },
};

export function coerceType(
  value: unknown,
  type: VariableType,
  variableName: string,
): string | number | boolean | null {
  if (!['str', 'int', 'float', 'bool'].includes(type)) {
    throw new Error(`Unsupported type '${type}' for variable '${variableName}'`);
  }

  if (value === null) {
    return null;
  }

  if (type === 'str') {
    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }

    return String(value);
  }

  const valueString = String(value);

  if (type === 'int') {
    const parsed = Number.parseInt(valueString, 10);

    if (Number.isNaN(parsed)) {
      throw new Error(`Cannot convert '${variableName}' value '${valueString}' to int`);
    }

    return parsed;
  }

  if (type === 'float') {
    const parsed = Number.parseFloat(valueString);

    if (Number.isNaN(parsed)) {
      throw new Error(`Cannot convert '${variableName}' value '${valueString}' to float`);
    }

    return parsed;
  }

  if (valueString === 'true' || valueString === 'True' || valueString === '1') {
    return true;
  }

  if (valueString === 'false' || valueString === 'False' || valueString === '0') {
    return false;
  }

  throw new Error(
    `Invalid boolean value for '${variableName}': '${valueString}'. Must be one of: 'true', 'True', '1', 'false', 'False', '0'`,
  );
}

export function maskSecret(value: string): string {
  if (value.length < 10) {
    return '**********';
  }

  return `${value.slice(0, 2)}****${value.slice(-4)}`;
}

export function loadYaml(path: string): Record<string, unknown> {
  let text: string;

  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error(`Configuration file '${path}' does not exist.`);
    }

    throw error;
  }

  const parsed = parse(text) ?? {};

  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(`Configuration file '${path}' must define a mapping at the root.`);
  }

  return parsed as Record<string, unknown>;
}
