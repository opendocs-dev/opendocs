export type InlineSegment = { kind: 'text' | 'bold' | 'code'; text: string };

const MAX_SPAN_LENGTH = 200;

function isValidBoldInner(inner: string): boolean {
  if (inner.length < 1 || inner.length > MAX_SPAN_LENGTH) return false;
  if (inner.includes('*') || inner.includes('\n') || inner.includes('\r')) return false;
  return inner.trim() === inner;
}

function isValidCodeInner(inner: string): boolean {
  if (inner.length < 1 || inner.length > MAX_SPAN_LENGTH) return false;
  return !inner.includes('`') && !inner.includes('\n') && !inner.includes('\r');
}

function splitBoldOnly(text: string): InlineSegment[] {
  const parts: InlineSegment[] = [];
  let plainStart = 0;
  let i = 0;

  while (i < text.length) {
    if (text[i] === '*' && text[i + 1] === '*') {
      const closeIndex = text.indexOf('**', i + 2);
      const inner = closeIndex === -1 ? '' : text.slice(i + 2, closeIndex);

      if (closeIndex !== -1 && isValidBoldInner(inner)) {
        if (i > plainStart) parts.push({ kind: 'text', text: text.slice(plainStart, i) });
        parts.push({ kind: 'bold', text: inner });
        i = closeIndex + 2;
        plainStart = i;
        continue;
      }
    }
    i++;
  }

  if (plainStart < text.length) parts.push({ kind: 'text', text: text.slice(plainStart) });

  return parts;
}

/**
 * Splits text into segments. Code spans (backtick + 1-200 chars with no backtick
 * and no newline + backtick) are found first, left to right; their content is
 * never parsed for bold. The text outside code spans is then split on `**bold**`
 * spans as before.
 */
export function splitInline(text: string): InlineSegment[] {
  const parts: InlineSegment[] = [];
  let plainStart = 0;
  let i = 0;

  while (i < text.length) {
    if (text[i] === '`') {
      const closeIndex = text.indexOf('`', i + 1);
      const inner = closeIndex === -1 ? '' : text.slice(i + 1, closeIndex);

      if (closeIndex !== -1 && isValidCodeInner(inner)) {
        if (i > plainStart) parts.push(...splitBoldOnly(text.slice(plainStart, i)));
        parts.push({ kind: 'code', text: inner });
        i = closeIndex + 1;
        plainStart = i;
        continue;
      }
    }
    i++;
  }

  if (plainStart < text.length) parts.push(...splitBoldOnly(text.slice(plainStart)));

  return parts;
}
