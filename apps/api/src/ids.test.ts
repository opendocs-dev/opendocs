import { PUBLIC_ID_LENGTH } from '@opendocs/core';
import { expect, test } from 'bun:test';
import { newPublicId } from './ids';

test('public ids are 16 base62 characters', () => {
  for (let index = 0; index < 100; index += 1) {
    const id = newPublicId();
    expect(id).toHaveLength(PUBLIC_ID_LENGTH);
    expect(id).toMatch(/^[0-9A-Za-z]{16}$/);
  }
});

test('every alphabet character can appear in the first position', () => {
  const first = new Set(Array.from({ length: 5000 }, () => newPublicId()[0]));
  expect(first.size).toBe(62);
});

test('1000 public ids are unique', () => {
  const ids = new Set(Array.from({ length: 1000 }, () => newPublicId()));
  expect(ids.size).toBe(1000);
});
