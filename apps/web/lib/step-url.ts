/**
 * Host and path helpers derived from a step's `page_url`, used by the top
 * bar ("On <host>") and the screenshot frame bar (path without scheme).
 * `page_url` is agent-supplied and may be malformed, so both fall back to a
 * best-effort string strip instead of throwing.
 */

function stripScheme(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

export function hostFromPageUrl(pageUrl?: string): string {
  if (!pageUrl) return '';

  try {
    return new URL(pageUrl).host;
  } catch {
    return stripScheme(pageUrl).split('/')[0];
  }
}

export function pathFromPageUrl(pageUrl?: string): string {
  if (!pageUrl) return '';
  return stripScheme(pageUrl);
}
