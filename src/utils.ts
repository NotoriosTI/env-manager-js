import type { VariableType } from './types.js';

export function coerceType(
  value: string | null,
  type: VariableType,
  variableName: string,
): string | number | boolean | null {
  void value;
  void type;
  void variableName;
  throw new Error('Not implemented');
}

export function maskSecret(value: string): string {
  void value;
  throw new Error('Not implemented');
}

export function loadYaml(path: string): unknown {
  void path;
  throw new Error('Not implemented');
}
