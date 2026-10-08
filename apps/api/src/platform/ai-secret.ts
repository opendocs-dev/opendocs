import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

const loadKey = (): Buffer => {
  const raw =
    process.env.AI_SECRET_KEY ??
    process.env.STORAGE_SECRET_KEY ??
    (process.env.NODE_ENV === 'test' ? '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' : undefined);
  if (!raw) {
    throw new Error('AI_SECRET_KEY or STORAGE_SECRET_KEY must be set to encrypt/decrypt AI secrets');
  }
  const key = raw.length === 64 ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('AI_SECRET_KEY must decode to 32 bytes (hex or base64 AES-256 key)');
  }
  return key;
};

export const encryptAiSecret = (plaintext: string, key: Buffer = loadKey()): string => {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, ciphertext, tag].map((part) => part.toString('base64')).join(':');
};

export const decryptAiSecret = (stored: string, key: Buffer = loadKey()): string => {
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

export const maskSecret = (secret: string): string => {
  if (!secret) return '';
  if (secret.length <= 8) return '••••••••';
  const prefix = secret.slice(0, 4);
  const suffix = secret.slice(-4);
  return `${prefix}••••••••${suffix}`;
};
