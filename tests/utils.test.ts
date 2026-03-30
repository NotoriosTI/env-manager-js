import { describe, expect, it } from 'vitest';

import { coerceType, maskSecret } from '../src/utils.js';

describe('coerceType', () => {
  it('returns string for str type', () => {
    expect(coerceType('value', 'str', 'TEST')).toBe('value');
  });

  it('returns integer for int type', () => {
    expect(coerceType('123', 'int', 'TEST')).toBe(123);
  });

  it('returns float for float type', () => {
    expect(coerceType('1.23', 'float', 'TEST')).toBe(1.23);
  });

  it('returns true for bool true values', () => {
    expect(coerceType('true', 'bool', 'FLAG')).toBe(true);
    expect(coerceType('1', 'bool', 'FLAG')).toBe(true);
  });

  it('returns false for bool false values', () => {
    expect(coerceType('false', 'bool', 'FLAG')).toBe(false);
    expect(coerceType('0', 'bool', 'FLAG')).toBe(false);
  });

  it('throws on invalid boolean value', () => {
    expect(() => coerceType('yes', 'bool', 'FLAG')).toThrow('Invalid boolean value');
  });

  it('throws on unsupported type', () => {
    expect(() => coerceType('value', 'date', 'TEST')).toThrow('Unsupported type');
  });

  it('returns null for null input', () => {
    expect(coerceType(null, 'str', 'X')).toBeNull();
  });
});

describe('maskSecret', () => {
  it('masks short values with 10 asterisks', () => {
    expect(maskSecret('short')).toBe('**********');
  });

  it('masks long values showing first 2 and last 4', () => {
    expect(maskSecret('password123')).toBe('pa****d123');
  });

  it('masks empty string with 10 asterisks', () => {
    expect(maskSecret('')).toBe('**********');
  });

  it('masks exactly 10-char value', () => {
    expect(maskSecret('1234567890')).toBe('12****7890');
  });
});
