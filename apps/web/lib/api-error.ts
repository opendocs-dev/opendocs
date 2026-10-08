/**
 * Extracts error message from an API error response body.
 * Reads body.error.message safely; falls back to fallback string.
 */
export function apiErrorMessage(body: unknown, fallback: string): string {
  try {
    if (
      typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof body.error === 'object' &&
      body.error !== null &&
      'message' in body.error &&
      typeof body.error.message === 'string'
    ) {
      return body.error.message;
    }
  } catch {
    // ignore
  }
  return fallback;
}
