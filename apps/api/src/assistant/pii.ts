/**
 * PII masking utilities for AI conversations (C20, AC-20)
 * Masks emails, phone numbers, credit card numbers, IP addresses, and secrets.
 */

const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const CREDIT_CARD_REGEX = /\b(?:\d[ -]*?){13,19}\b/g;
const PHONE_REGEX = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/g;
const IP_REGEX = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const SECRET_REGEX = /\b(?:sk-[a-zA-Z0-9_\-]{16,}|Bearer\s+[a-zA-Z0-9._\-]{16,})\b/g;

export const maskPii = (text: string | null | undefined): string => {
  if (!text) return '';
  return text
    .replace(SECRET_REGEX, '[SECRET]')
    .replace(CREDIT_CARD_REGEX, (match) => {
      // Only mask if it contains at least 13 digits
      const digits = match.replace(/\D/g, '');
      if (digits.length >= 13 && digits.length <= 19) {
        return '[CARD]';
      }
      return match;
    })
    .replace(EMAIL_REGEX, '[EMAIL]')
    .replace(PHONE_REGEX, (match) => {
      const digits = match.replace(/\D/g, '');
      if (digits.length >= 7 && digits.length <= 15) {
        return '[PHONE]';
      }
      return match;
    })
    .replace(IP_REGEX, '[IP]');
};
