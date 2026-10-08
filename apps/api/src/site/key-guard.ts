import { Elysia } from 'elysia';
import { auth } from '../auth';
import { errorResponse } from '../errors';
import { roleFor } from './role';
import { getInstanceOrg } from '../instance-org';

const KEY_PATHS = new Set([
  '/api/auth/api-key/create',
  '/api/auth/api-key/list',
  '/api/auth/api-key/delete',
  '/api/auth/api-key/update',
]);

/**
 * Plugin that guards API key management endpoints to only allow owners and admins.
 * Checks the session and role before allowing access to key endpoints.
 */
export const keyGuard = new Elysia()
  .onRequest(async ({ request, status }) => {
    const url = new URL(request.url);
    const path = url.pathname;

    // Only guard these specific paths
    if (!KEY_PATHS.has(path)) return;

    // Load the session
    const session = await auth.api.getSession({ headers: request.headers });
    const organizationId = session ? (await getInstanceOrg()).id : undefined;

    // Check for valid session and organization
    if (!session || !organizationId) {
      return status(401, errorResponse('unauthorized', 'A valid session is required'));
    }

    // Check the user's role
    const role = await roleFor(session.user.id, organizationId);
    if (role !== 'owner' && role !== 'admin') {
      return status(403, errorResponse('unauthorized', 'Only owners and admins can manage API keys'));
    }
  });
