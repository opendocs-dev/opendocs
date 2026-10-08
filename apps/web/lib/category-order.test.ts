import { describe, expect, test } from 'bun:test';
import { moveCategory, positionsFor, validateCategoryName } from './category-order';

describe('moveCategory', () => {
  test('moves an item up', () => {
    expect(moveCategory(['a', 'b', 'c'], 'b', 'up')).toEqual(['b', 'a', 'c']);
  });

  test('moves an item down', () => {
    expect(moveCategory(['a', 'b', 'c'], 'b', 'down')).toEqual(['a', 'c', 'b']);
  });

  test('does not move the first item up', () => {
    expect(moveCategory(['a', 'b', 'c'], 'a', 'up')).toEqual(['a', 'b', 'c']);
  });

  test('does not move the last item down', () => {
    expect(moveCategory(['a', 'b', 'c'], 'c', 'down')).toEqual(['a', 'b', 'c']);
  });

  test('returns the same order for an unknown id', () => {
    expect(moveCategory(['a', 'b', 'c'], 'unknown', 'up')).toEqual(['a', 'b', 'c']);
  });

  test('works with a single item', () => {
    expect(moveCategory(['a'], 'a', 'up')).toEqual(['a']);
    expect(moveCategory(['a'], 'a', 'down')).toEqual(['a']);
  });
});

describe('positionsFor', () => {
  test('returns position metadata for each id', () => {
    expect(positionsFor(['a', 'b', 'c'])).toEqual([
      { id: 'a', position: 0 },
      { id: 'b', position: 1 },
      { id: 'c', position: 2 },
    ]);
  });

  test('handles empty array', () => {
    expect(positionsFor([])).toEqual([]);
  });

  test('works with a single item', () => {
    expect(positionsFor(['a'])).toEqual([{ id: 'a', position: 0 }]);
  });
});

describe('validateCategoryName', () => {
  test('returns null for a valid name', () => {
    expect(validateCategoryName('My Category')).toBeNull();
  });

  test('returns error for empty string', () => {
    expect(validateCategoryName('')).toBe('Enter a name');
  });

  test('returns error for whitespace only', () => {
    expect(validateCategoryName('   ')).toBe('Enter a name');
  });

  test('returns error for name longer than 40 characters', () => {
    expect(validateCategoryName('This is a very long category name that exceeds the limit')).toBe(
      'Use 40 characters or fewer',
    );
  });

  test('returns error for name with no letters or numbers', () => {
    expect(validateCategoryName('!@#$%')).toBe('Use at least one letter or number');
  });

  test('accepts name with exactly 40 characters', () => {
    const name = 'a'.repeat(40);
    expect(validateCategoryName(name)).toBeNull();
  });

  test('accepts name with 41 characters (exceeds limit)', () => {
    const name = 'a'.repeat(41);
    expect(validateCategoryName(name)).toBe('Use 40 characters or fewer');
  });

  test('accepts name with letters and special characters', () => {
    expect(validateCategoryName('My Category & More')).toBeNull();
  });

  test('trims whitespace before validating', () => {
    expect(validateCategoryName('  My Category  ')).toBeNull();
  });

  test('accepts name with numbers only', () => {
    expect(validateCategoryName('12345')).toBeNull();
  });

  test('rejects name with spaces and special characters only', () => {
    expect(validateCategoryName('   !@# ')).toBe('Use at least one letter or number');
  });
});
