/**
 * Swap a staging host for its public host in `page_url`, so a doc recorded on
 * staging reads as production. Only the host (and port) is swapped; scheme,
 * path, query and hash are kept unless `to` carries its own scheme.
 *
 * @see Contract - Public URL Map for Staging Recordings (vault), AC-01.
 */

/** One `from` host (lowercased, with port if given) to its replacement. */
export type UrlMap = Map<string, string>;

/**
 * Parse `OPENDOCS_URL_MAP` into a host → replacement map.
 *
 * Format: comma-separated `from=to` pairs, e.g. `pfnapp.my.id=pfnapp.id`.
 * `from` is lowercased for case-insensitive, exact (non-subdomain) matching.
 * An invalid entry - missing `=`, empty `from`, or empty `to` - is skipped and
 * reported on one `warn` line naming it; valid entries still apply and the
 * server still starts.
 *
 * @param env Environment to read `OPENDOCS_URL_MAP` from.
 * @param warn Called once per invalid entry with a one-line message.
 */
export function parseUrlMap(
  env: Record<string, string | undefined> = process.env,
  warn: (line: string) => void = (line) => process.stderr.write(line)
): UrlMap {
  const map: UrlMap = new Map();
  const raw = env.OPENDOCS_URL_MAP?.trim();
  if (!raw) return map;

  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    const from = eq === -1 ? '' : trimmed.slice(0, eq).trim();
    const to = eq === -1 ? '' : trimmed.slice(eq + 1).trim();
    if (eq === -1 || from.length === 0 || to.length === 0) {
      warn(`OPENDOCS_URL_MAP: skipping invalid entry "${trimmed}"\n`);
      continue;
    }
    map.set(from.toLowerCase(), to);
  }
  return map;
}

/**
 * Rewrite `pageUrl`'s host via `map`, if it matches.
 *
 * Only `host` (and `protocol`, when `to` carries a scheme) is replaced; path,
 * query and hash are kept, and any `to` path is ignored. Matching is exact and
 * case-insensitive; subdomains are not matched implicitly. A malformed
 * `pageUrl`, or a host with no entry in `map`, is returned unchanged.
 *
 * @param pageUrl The URL as given to `opendocs_step`.
 * @param map Parsed via {@link parseUrlMap}.
 * @returns The possibly-rewritten URL, and whether a rewrite happened.
 */
export function mapPageUrl(pageUrl: string, map: UrlMap): { url: string; rewritten: boolean } {
  let parsed: URL;
  try {
    parsed = new URL(pageUrl);
  } catch {
    return { url: pageUrl, rewritten: false };
  }

  const to = map.get(parsed.host.toLowerCase());
  if (to === undefined) return { url: pageUrl, rewritten: false };

  // A `to` with a scheme (e.g. "https://pfnapp.id") replaces the protocol too;
  // a bare host (e.g. "pfnapp.id") only replaces host/port. Credentials are
  // dropped either way, since the URL is rebuilt from parts.
  let toUrl: URL;
  try {
    toUrl = new URL(to.includes('://') ? to : `${parsed.protocol}//${to}`);
  } catch {
    return { url: pageUrl, rewritten: false };
  }

  parsed.protocol = toUrl.protocol;
  parsed.hostname = toUrl.hostname;
  parsed.port = toUrl.port;
  parsed.username = '';
  parsed.password = '';
  return { url: parsed.toString(), rewritten: true };
}
