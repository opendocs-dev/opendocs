import { headers } from 'next/headers';

/**
 * Absolute origin for this app. PUBLIC_APP_ORIGIN is the source of truth so
 * an attacker-controlled Host or X-Forwarded-Proto header can't poison
 * unfurl caches (og:url/og:image) or the share link. Request headers are
 * only trusted outside production, where PUBLIC_APP_ORIGIN is often unset.
 */
function publicOrigin(): string | null {
  const configured = process.env.PUBLIC_APP_ORIGIN;
  if (configured) return configured.replace(/\/+$/, '');

  return null;
}

async function devOrigin(): Promise<string> {
  const requestHeaders = await headers();
  const host = requestHeaders.get('host') ?? 'localhost:3000';
  const protocol = requestHeaders.get('x-forwarded-proto') ?? 'https';

  return `${protocol}://${host}`;
}

/**
 * Absolute URL for a doc page, for the share row and print header. Falls
 * back to a relative URL in production when PUBLIC_APP_ORIGIN isn't set,
 * rather than trusting request headers.
 */
export async function absoluteDocUrl(id: string): Promise<string> {
  const path = `/d/${encodeURIComponent(id)}`;
  const origin = publicOrigin();

  if (origin) return `${origin}${path}`;
  if (process.env.NODE_ENV !== 'production') return `${await devOrigin()}${path}`;

  return path;
}

/**
 * Absolute URL for og:url/og:image. Returns null in production when
 * PUBLIC_APP_ORIGIN isn't set, since these must never be built from
 * unvalidated request headers.
 */
export async function absoluteMetadataUrl(id: string): Promise<string | null> {
  const path = `/d/${encodeURIComponent(id)}`;
  const origin = publicOrigin();

  if (origin) return `${origin}${path}`;
  if (process.env.NODE_ENV !== 'production') return `${await devOrigin()}${path}`;

  return null;
}
