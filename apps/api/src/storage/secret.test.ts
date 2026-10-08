import { randomBytes } from 'node:crypto';
import { expect, test } from 'bun:test';
import { decryptSecret, encryptSecret } from './secret';

const key = () => randomBytes(32);

test('round-trips a secret through encrypt then decrypt', () => {
  const plaintext = JSON.stringify({ refreshToken: 'a-refresh-token' });
  const stored = encryptSecret(plaintext, key());
  // Re-decrypt with the same key the caller used — a fresh random key per call
  // would never match, so the test passes the key through explicitly.
  const sameKey = key();
  const sameKeyStored = encryptSecret(plaintext, sameKey);
  expect(decryptSecret(sameKeyStored, sameKey)).toBe(plaintext);
  expect(stored).not.toBe(plaintext);
});

test('stored value never contains the plaintext secret', () => {
  const secretValue = 'super-secret-refresh-token-value';
  const stored = encryptSecret(secretValue, key());
  expect(stored).not.toContain(secretValue);
});

test('two encryptions of the same plaintext produce different ciphertext (random iv)', () => {
  const k = key();
  const a = encryptSecret('same-plaintext', k);
  const b = encryptSecret('same-plaintext', k);
  expect(a).not.toBe(b);
});

test('decrypting with the wrong key throws', () => {
  const stored = encryptSecret('plaintext', key());
  expect(() => decryptSecret(stored, key())).toThrow();
});

test('decrypting a tampered ciphertext throws (GCM auth tag check)', () => {
  const k = key();
  const stored = encryptSecret('plaintext', k);
  const [iv, ciphertext, tag] = stored.split(':');
  const tamperedByte = Buffer.from(ciphertext!, 'base64');
  tamperedByte[0] = (tamperedByte[0] ?? 0) ^ 0xff;
  const tampered = [iv, tamperedByte.toString('base64'), tag].join(':');
  expect(() => decryptSecret(tampered, k)).toThrow();
});

test('decrypting a malformed stored value throws', () => {
  expect(() => decryptSecret('not-the-right-shape', key())).toThrow(
    'Stored secret is not in the expected iv:ciphertext:tag shape',
  );
});
