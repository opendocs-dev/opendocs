/**
 * Client-side masking of PII in step text before it leaves the machine.
 */
import { maskTextWithDetails } from '@opendocs/core/redaction';

export interface MaskStepTextResult {
  text: string;
  count: number;
}

/** Mask PII in step text, always, independent of the redact mode. */
export function maskStepText(text: string): MaskStepTextResult {
  const { text: masked, count } = maskTextWithDetails(text);
  return { text: masked, count };
}
