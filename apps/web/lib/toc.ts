import type { DocStep } from '@opendocs/core';

import { splitInline } from './inline-bold';

const MAX_LABEL_LENGTH = 60;

function stripInlineMarkers(text: string): string {
  return splitInline(text)
    .map((part) => part.text)
    .join('');
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

export function tocLabel(step: DocStep): string {
  const raw = step.title ?? stripInlineMarkers(step.instruction);
  return truncate(raw, MAX_LABEL_LENGTH);
}
