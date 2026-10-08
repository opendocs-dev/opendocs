export type AddressStatus = 'available' | 'taken' | 'reserved' | 'invalid';

export interface AddressMessage {
  tone: 'ok' | 'warn' | 'bad';
  text: string;
}

/**
 * Returns a message for an address check status.
 * 'available' => 'Available'
 * 'taken' => 'Already in use'
 * 'reserved' => 'Reserved name, pick another'
 * 'invalid' => reason from API or 'Use 3-30 letters, numbers and hyphens'
 */
export function addressMessage(
  status: AddressStatus,
  reason?: string | null,
  current?: string | null,
): AddressMessage {
  switch (status) {
    case 'available':
      return { tone: 'ok', text: 'Available' };
    case 'taken':
      return { tone: 'bad', text: 'Already in use' };
    case 'reserved':
      return { tone: 'warn', text: 'Reserved name, pick another' };
    case 'invalid':
      return {
        tone: 'bad',
        text: reason || 'Use 3-30 letters, numbers and hyphens',
      };
    default:
      return { tone: 'bad', text: 'Unknown status' };
  }
}

/**
 * Formats the domain suffix for an address.
 * Uses the parent domain of the host if provided, or defaults to '.opendocs.xxx'.
 */
export function formatAddressSuffix(host: string | null | undefined): string {
  if (!host) return '.opendocs.xxx';
  const parts = host.split('.');
  if (parts.length <= 1) return '.opendocs.xxx';
  return `.${parts.slice(1).join('.')}`;
}

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
