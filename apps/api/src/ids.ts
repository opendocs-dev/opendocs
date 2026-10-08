import { PUBLIC_ID_LENGTH } from '@opendocs/core';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
// 248 = 4 * 62: bytes at or above it are dropped so `byte % 62` stays uniform.
const LIMIT = 248;

/**
 * A 16-char base62 public id: every character is uniform over the 62-char alphabet
 * (rejection sampling), so an id carries 16 * log2(62) ~= 95.3 bits of randomness.
 */
export const newPublicId = (): string => {
  let id = '';
  while (id.length < PUBLIC_ID_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(PUBLIC_ID_LENGTH * 2))) {
      if (byte < LIMIT && id.length < PUBLIC_ID_LENGTH) id += ALPHABET[byte % ALPHABET.length];
    }
  }
  return id;
};
