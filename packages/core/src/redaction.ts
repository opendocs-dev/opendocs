/**
 * Client-side PII detection and redaction patterns.
 * Source: ADR - Client-side Redaction, Contract - CLI and MCP v1 (AC-06).
 */

/**
 * Validates a number string using the Luhn checksum algorithm.
 */
export function isLuhnValid(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) {
    return false;
  }

  let sum = 0;
  let alternate = false;

  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits.charAt(i), 10);
    if (Number.isNaN(n)) return false;

    if (alternate) {
      n *= 2;
      if (n > 9) {
        n -= 9;
      }
    }
    sum += n;
    alternate = !alternate;
  }

  return sum % 10 === 0;
}

/** Email pattern */
export const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;

/** Indonesian phone number pattern (+62, 62, or 08 prefix) */
export const PHONE_ID_PATTERN = /(?:\+62|62|08)[0-9\s-]{7,13}[0-9]\b/;

/** Card candidate pattern (13-19 digits, with optional spaces or dashes) */
export const CARD_CANDIDATE_PATTERN = /\b(?:\d[ -]*?){13,19}\b/;

/** Indonesian NIK (Nomor Induk Kependudukan, exactly 16 digits) */
export const NIK_PATTERN = /\b\d{16}\b/;

/** Indonesian NPWP (formatted 15 digits or unformatted 15 digits) */
export const NPWP_PATTERN = /(?:\b\d{2}\.\d{3}\.\d{3}\.\d{1}-\d{3}\.\d{3}\b|\b\d{15}\b)/;

/** Token patterns: OpenAI/Stripe sk_, GitHub ghp_, AWS AKIA, and JWT eyJ... */
export const TOKEN_SK_PATTERN = /\bsk_(?:live|test)_[A-Za-z0-9_-]+\b|\bsk_[A-Za-z0-9_-]{16,}\b/;
export const TOKEN_GHP_PATTERN = /\bghp_[A-Za-z0-9]{20,}\b/;
export const TOKEN_AKIA_PATTERN = /\bAKIA[0-9A-Z]{16}\b/;
export const TOKEN_JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/;

/** Composite token pattern matching any supported token / secret */
export const TOKEN_PATTERN = new RegExp(
  `${TOKEN_SK_PATTERN.source}|${TOKEN_GHP_PATTERN.source}|${TOKEN_AKIA_PATTERN.source}|${TOKEN_JWT_PATTERN.source}`,
);

export interface MaskResult {
  text: string;
  count: number;
  tags: string[];
}

/**
 * Masks sensitive PII in text using the canonical pattern ordering:
 * 1. Tokens (sk_, ghp_, AKIA, JWT) -> [token]
 * 2. Email -> [email]
 * 3. Card (Luhn-checked) -> [card] (checked before NIK so valid cards are not tagged [nik])
 * 4. NIK (16 digits) -> [nik]
 * 5. NPWP -> [npwp]
 * 6. Indonesian phone numbers -> [phone]
 */
export function maskTextWithDetails(input: string): MaskResult {
  let result = input;
  let count = 0;
  const tags: string[] = [];
  const globalPattern = (pattern: RegExp) => new RegExp(pattern.source, 'g');

  const recordMask = (tag: string) => {
    count++;
    if (!tags.includes(tag)) {
      tags.push(tag);
    }
  };

  // 1. Tokens
  result = result.replace(globalPattern(TOKEN_SK_PATTERN), () => {
    recordMask('[token]');
    return '[token]';
  });
  result = result.replace(globalPattern(TOKEN_GHP_PATTERN), () => {
    recordMask('[token]');
    return '[token]';
  });
  result = result.replace(globalPattern(TOKEN_AKIA_PATTERN), () => {
    recordMask('[token]');
    return '[token]';
  });
  result = result.replace(globalPattern(TOKEN_JWT_PATTERN), () => {
    recordMask('[token]');
    return '[token]';
  });

  // 2. Email
  result = result.replace(globalPattern(EMAIL_PATTERN), () => {
    recordMask('[email]');
    return '[email]';
  });

  // 3. Card numbers (Luhn checked)
  // Must run BEFORE NIK so a 16-digit card is masked as [card]
  result = result.replace(globalPattern(CARD_CANDIDATE_PATTERN), (match) => {
    const rawDigits = match.replace(/\D/g, '');
    if (rawDigits.length >= 13 && rawDigits.length <= 19 && isLuhnValid(rawDigits)) {
      recordMask('[card]');
      return '[card]';
    }
    return match;
  });

  // 4. NIK (16 contiguous digits)
  result = result.replace(globalPattern(NIK_PATTERN), () => {
    recordMask('[nik]');
    return '[nik]';
  });

  // 5. NPWP
  result = result.replace(globalPattern(NPWP_PATTERN), () => {
    recordMask('[npwp]');
    return '[npwp]';
  });

  // 6. Indonesian phone
  result = result.replace(globalPattern(PHONE_ID_PATTERN), (match) => {
    const digitsOnly = match.replace(/\D/g, '');
    if (digitsOnly.length >= 9 && digitsOnly.length <= 14) {
      recordMask('[phone]');
      return '[phone]';
    }
    return match;
  });

  return { text: result, count, tags };
}

/**
 * Masks sensitive PII in text and returns the masked string.
 */
export function maskText(input: string): string {
  return maskTextWithDetails(input).text;
}

/**
 * Shared redaction patterns collection.
 */
export const REDACTION_PATTERNS = {
  email: EMAIL_PATTERN,
  phoneId: PHONE_ID_PATTERN,
  cardCandidate: CARD_CANDIDATE_PATTERN,
  nik: NIK_PATTERN,
  npwp: NPWP_PATTERN,
  tokenSk: TOKEN_SK_PATTERN,
  tokenGhp: TOKEN_GHP_PATTERN,
  tokenAkia: TOKEN_AKIA_PATTERN,
  tokenJwt: TOKEN_JWT_PATTERN,
  token: TOKEN_PATTERN,
} as const;
