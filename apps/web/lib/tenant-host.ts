/** Lowercase, port and trailing dot removed, so `A.Base.:443` and `a.base` are the same host. */
export const normalizeHost = (host: string): string =>
  host.split(':')[0]!.toLowerCase().replace(/\.+$/, '');

/** True for the base domain itself and anything below it, valid tenant label or not. */
export const isUnderBase = (host: string, base: string | undefined): boolean => {
  if (!base) return false;
  const h = normalizeHost(host);
  const b = base.toLowerCase();
  return h === b || h.endsWith(`.${b}`);
};

const LABEL_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/**
 * Extracts the tenant slug from `host` when it is exactly `<label>.<base>` (one label),
 * case-insensitive and with any port stripped first. Returns null when tenant routing is
 * off (`base` unset/empty), the host isn't under `base`, or it has more than one label
 * before it (e.g. `a.b.base`).
 */
export function parseTenantHost(host: string, base: string | undefined): string | null {
  if (!base) return null;

  const normalizedHost = normalizeHost(host);
  const normalizedBase = base.toLowerCase();

  if (!normalizedHost.endsWith(`.${normalizedBase}`)) return null;

  const label = normalizedHost.slice(0, normalizedHost.length - normalizedBase.length - 1);
  if (label.length === 0 || label.includes('.')) return null;
  if (!LABEL_PATTERN.test(label)) return null;

  return label;
}

/** Rewrites `/` to `/tenant/{slug}` and any other path to `/tenant/{slug}{pathname}`. */
export function tenantRewritePath(slug: string, pathname: string): string {
  const base = `/tenant/${slug}`;
  return pathname === '/' ? base : `${base}${pathname}`;
}
