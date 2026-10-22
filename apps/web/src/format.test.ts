import { describe, expect, it } from 'vitest';
import { formatLength, parseLength, parseSquareMeters } from './format';

describe('lengths', () => {
  it('shows feet and inches on imperial plans', () => {
    expect(formatLength(3.7592, true)).toBe('12′ 4″');
    expect(formatLength(3.048, true)).toBe('10′');
    expect(formatLength(3.6, false)).toBe('3.60 m');
  });

  it('reads what the user types', () => {
    expect(parseLength(`12'4"`, false)).toBeCloseTo(3.7592, 6);
    expect(parseLength('360 cm', true)).toBeCloseTo(3.6, 9);
    expect(parseLength('12', true)).toBeCloseTo(3.6576, 6);
    expect(parseLength('3,6', false)).toBe(3.6);
    expect(parseLength('12 x 10', true)).toBeUndefined();
    expect(parseLength('soon', true)).toBeUndefined();
  });

  it('reads areas', () => {
    expect(parseSquareMeters('450 sq ft', false)).toBeCloseTo(41.806, 3);
    expect(parseSquareMeters('42', false)).toBe(42);
    expect(parseSquareMeters('450', true)).toBeCloseTo(41.806, 3);
  });
});
