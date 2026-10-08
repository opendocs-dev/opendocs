import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

/**
 * Loads the 32-byte key from `STORAGE_SECRET_KEY` (base64 or hex), once per process.
 * Thrown lazily (not at import time) so modules that only read non-secret config
 * never need the key configured.
 */
const loadKey = (): Buffer => {
  const raw = process.env.STORAGE_SECRET_KEY;
  if (!raw) throw new Error('STORAGE_SECRET_KEY is not set');
  const key = /^[0-9a-fA-F]+$/.test(raw) && raw.length === 64 ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('STORAGE_SECRET_KEY must decode to 32 bytes (hex or base64 AES-256 key)');
  }
  return key;
};

/**
 * Encrypts `plaintext` (a Drive refresh token or an S3 key pair, serialized by the
 * caller) with AES-256-GCM. Stored as `iv:ciphertext:tag`, each base64 — the shape
 * `StorageConnection.secret` documents in schema.prisma.
 */
export const encryptSecret = (plaintext: string, key: Buffer = loadKey()): string => {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, ciphertext, tag].map((part) => part.toString('base64')).join(':');
};

/** Reverses `encryptSecret`. Throws if the key is wrong or the value was tampered with. */
export const decryptSecret = (stored: string, key: Buffer = loadKey()): string => {
  const parts = stored.split(':');
  if (parts.length !== 3) throw new Error('Stored secret is not in the expected iv:ciphertext:tag shape');
  const [ivPart, ciphertextPart, tagPart] = parts as [string, string, string];
  const iv = Buffer.from(ivPart, 'base64');
  const ciphertext = Buffer.from(ciphertextPart, 'base64');
  const tag = Buffer.from(tagPart, 'base64');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
};
