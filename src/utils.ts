import type { VariableType } from './types.js';

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

export function loadYaml(path: string): unknown {
  void path;
  throw new Error('Not implemented');
}
