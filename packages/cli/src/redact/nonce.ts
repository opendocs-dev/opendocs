/**
 * Tracks nonces issued by `opendocs_redaction_script` so `opendocs_step` and
 * `opendocs_snap` can tell a `redaction_report` that really came from running
 * the emitted script from one an agent invented or edited: the nonce must be
 * known, unused, and issued within the last 30 minutes.
 */

const MAX_NONCES = 200;
const NONCE_TTL_MS = 30 * 60 * 1000;

interface NonceEntry {
  issuedAt: number;
  used: boolean;
}

export interface NonceStore {
  /** Issue a fresh nonce, dropping the oldest entry first if already at capacity. */
  issue(): string;
  /** True when `nonce` is known, unused and issued within the last 30 minutes. */
  isValid(nonce: string): boolean;
  /** Mark `nonce` used so a replay of the same report is rejected. */
  consume(nonce: string): void;
}

export function createNonceStore(): NonceStore {
  const entries = new Map<string, NonceEntry>();

  return {
    issue() {
      const nonce = crypto.randomUUID();
      if (entries.size >= MAX_NONCES) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }
      entries.set(nonce, { issuedAt: Date.now(), used: false });
      return nonce;
    },
    isValid(nonce) {
      const entry = entries.get(nonce);
      if (!entry || entry.used) return false;
      return Date.now() - entry.issuedAt <= NONCE_TTL_MS;
    },
    consume(nonce) {
      const entry = entries.get(nonce);
      if (entry) entry.used = true;
    },
  };
}
