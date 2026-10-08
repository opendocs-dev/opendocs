import dns from 'node:dns';

const DOMAIN_PATTERN = /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+(?<!-)$/;
const MAX_DOMAIN_LENGTH = 253;

export type DomainValidation = { ok: true; domain: string } | { ok: false; reason: string };

/** Lowercases first, so casing alone never changes the result. */
export const validateDomain = (input: string): DomainValidation => {
  const domain = input.trim().toLowerCase();

  if (domain.length === 0 || domain.length > MAX_DOMAIN_LENGTH) {
    return { ok: false, reason: `Domain must be 1-${MAX_DOMAIN_LENGTH} characters` };
  }
  if (!DOMAIN_PATTERN.test(domain)) {
    return { ok: false, reason: 'Domain must be a valid host name, e.g. docs.example.com' };
  }
  if (domain.includes('..')) {
    return { ok: false, reason: 'Domain cannot contain repeated dots' };
  }

  return { ok: true, domain };
};

/**
 * The CNAME record a tenant must add to point `domain` at their OpenDocs address.
 *
 * DNS verification method (documented per Issue - OD Domain Verification): a CNAME record
 * is the single check used here, not a TXT record. A CNAME both proves control of the
 * domain's DNS (only the owner can add it) and is also the record that would actually
 * route traffic once a TLS/reachability mechanism exists, so one record serves both the
 * verification check today and real routing later with no second record to add. A TXT
 * record would only ever serve verification, requiring a second record anyway.
 */
export const expectedCnameTarget = (slug: string, baseDomain: string): string => `${slug}.${baseDomain}`;

export type DnsResolver = (hostname: string) => Promise<string[]>;

/** Real resolver: looks up the CNAME chain's target host names. Injected so tests never hit the network. */
export const resolveCname: DnsResolver = (hostname) => dns.promises.resolveCname(hostname);

/**
 * True when `domain`'s CNAME resolves to `expectedTarget` (trailing dot ignored, case-insensitive).
 * Any resolution failure (NXDOMAIN, no CNAME record, timeout) is treated as "not found", never thrown.
 */
export const checkCnameMatch = async (
  domain: string,
  expectedTarget: string,
  resolver: DnsResolver = resolveCname,
): Promise<boolean> => {
  try {
    const targets = await resolver(domain);
    const normalized = expectedTarget.toLowerCase().replace(/\.$/, '');
    return targets.some((target) => target.toLowerCase().replace(/\.$/, '') === normalized);
  } catch {
    return false;
  }
};
