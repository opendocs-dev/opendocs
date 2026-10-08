import { CLI_MIN_VERSION, ERROR_CODES, type ErrorCode } from '@opendocs/core';
import { Elysia } from 'elysia';

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly errorCode: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** The single error body shape every route answers with. */
export const errorResponse = (code: ErrorCode, message: string) => ({
  error: { code, message },
});

export const errorPlugin = new Elysia()
  .onRequest(({ request, status }) => {
    if (!new URL(request.url).pathname.startsWith('/api/v1/')) return;

    const version = request.headers.get('x-opendocs-cli-version');
    if (version) {
      try {
        if (Bun.semver.order(version, CLI_MIN_VERSION) < 0) {
          return status(426, errorResponse('upgrade_required', 'CLI upgrade required'));
        }
      } catch {
        // Ignore malformed version headers.
      }
    }
  })
  .onError(({ code, error, status }) => {
    if (error instanceof ApiError && ERROR_CODES.includes(error.errorCode)) {
      return status(error.statusCode, errorResponse(error.errorCode, error.message));
    }
    if (code === 'NOT_FOUND') {
      return status(404, errorResponse('not_found', 'Route not found'));
    }
    if (code === 'VALIDATION' || code === 'PARSE') {
      return status(422, errorResponse('validation_failed', 'Invalid request'));
    }
    // Unexpected: the client gets a generic 500, so the cause must reach the server log.
    console.error('internal_error', error);
    return status(500, errorResponse('internal_error', 'Internal server error'));
  })
  .as('global');
