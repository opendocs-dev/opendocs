import { auth } from './auth';
import { ApiError } from './errors';
import { getInstanceOrg } from './instance-org';

export const unauthorized = () =>
  new ApiError(401, 'unauthorized', 'A valid API key or session is required');

/**
 * Resolves the caller's workspace: an `x-api-key` header wins (its owning Organization),
 * otherwise a session means the instance workspace. Either way the answer is an Organization id.
 */
export const resolveOrganizationId = async (request: Request): Promise<string> => {
  const key = request.headers.get('x-api-key');

  if (key) {
    const result = await auth.api.verifyApiKey({ body: { key } });
    const referenceId = result.key?.referenceId;
    if (!result.valid || !referenceId) throw unauthorized();
    return referenceId;
  }

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw unauthorized();
  return (await getInstanceOrg()).id;
};
