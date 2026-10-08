import { crc32 } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Serialises one PNG chunk: length, type, payload, CRC32 over type+payload. */
const chunk = (type: string, payload: Buffer) => {
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), payload]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.byteLength, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed) >>> 0, 0);
  return Buffer.concat([length, typed, crc]);
};

const ihdr = (width: number, height: number) => {
  const payload = Buffer.alloc(13);
  payload.writeUInt32BE(width, 0);
  payload.writeUInt32BE(height, 4);
  payload[8] = 8; // bit depth
  payload[9] = 6; // colour type: RGBA
  return chunk('IHDR', payload);
};

/** Copies into a plain ArrayBuffer-backed view, which is what `BodyInit` accepts. */
const toBytes = (buffer: Buffer): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(buffer);
  return bytes;
};

/**
 * A PNG carrying a real signature and a CRC-correct IHDR. `metadata()` only reads the
 * header, so no pixel data is needed to exercise the dimension checks.
 */
export const pngWithDimensions = (width: number, height: number): Uint8Array<ArrayBuffer> =>
  toBytes(Buffer.concat([PNG_SIGNATURE, ihdr(width, height)]));

/** A small, valid PNG for the happy path. */
export const tinyPng = (): Uint8Array<ArrayBuffer> => pngWithDimensions(4, 4);

/**
 * Pads a PNG to an exact byte length with a private ancillary chunk ("odPd"), which
 * decoders must skip. 12 bytes is the smallest chunk, so `total` must leave room.
 */
export const pngOfExactSize = (total: number): Uint8Array<ArrayBuffer> => {
  const head = Buffer.concat([PNG_SIGNATURE, ihdr(4, 4)]);
  const padding = total - head.byteLength - 12;
  if (padding < 0) throw new Error(`Cannot pad a PNG down to ${total} bytes`);
  return toBytes(Buffer.concat([head, chunk('odPd', Buffer.alloc(padding, 0x61))]));
};

export const svgBytes = (): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"></svg>');

/** A real 64x64 WebP (242 bytes), encoded once from the CLI fixture, for the RIFF/WEBP path. */
export const tinyWebp = (): Uint8Array<ArrayBuffer> => toBytes(Buffer.from('UklGRuoAAABXRUJQVlA4IN4AAACQCACdASpAAEAAPm0wkkayIyGhLAgCQA2JYjONegSAAFLTZ+qf5n7AAJJ/waDCo4kd4G3mQ4ftx///U6nCgIpl//99xQExTbx5N92fMAD+/6DU6mCVjkfOhi0I8uNUKj2DdJnq/rAPrkVF243S7MPMrGu8Ul80qyiVfB8x8Hnunp8OP5rWxLluq4jfQAz49c78P9t9P94sotsk6aZc9g6mR4CWpx6trTZcpJYfCfztO7j2rgviRmudIeJaevtpnAKp4RL+rOYWD1eaTGcxWXBtVBitBN4RFD4bIgiYwAA=', 'base64'));
