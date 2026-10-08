import { CLI_MIN_VERSION, type MeResponse, MeResponseSchema } from '@opendocs/core';
import { Elysia } from 'elysia';
import { auth } from '../auth';
import { resolveOrganizationId, unauthorized } from '../auth-context';
import { getPrisma } from '../db';
import { getLimits } from '../env';
import { roleFor } from '../site/role';
import { touchMemberLastActive } from '../site/session';

/** Live step-image bytes of the workspace: what `STORAGE_QUOTA_BYTES` is measured against. */
const liveStepBytes = async (organizationId: string): Promise<number> => {
  const usage = await getPrisma().asset.aggregate({
    where: {
      organizationId,
      kind: 'step',
      deletedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    _sum: { bytes: true },
  });
  return usage._sum.bytes ?? 0;
};

export const meRoute = new Elysia().get(
  '/api/v1/me',
  async ({ request }) => {
    const organizationId = await resolveOrganizationId(request);

    const organization = await getPrisma().organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, slug: true },
    });
    if (!organization) throw unauthorized();

    const result: MeResponse = {
      workspace: { id: organization.id, name: organization.name, slug: organization.slug },
      min_cli_version: CLI_MIN_VERSION,
    };

    // `quota` only exists when the operator set a storage cap (AC-14).
    const { storageQuotaBytes } = getLimits();
    if (storageQuotaBytes > 0) {
      result.quota = {
        // The cap is on bytes, not files; files_left stays in the contract shape as "unlimited".
        files_left: Number.MAX_SAFE_INTEGER,
        bytes_left: Math.max(0, storageQuotaBytes - (await liveStepBytes(organizationId))),
      };
    }

    // Add role for session callers only
    const session = await auth.api.getSession({ headers: request.headers });
    if (session) {
      void touchMemberLastActive(session.user.id, organizationId);
      const role = await roleFor(session.user.id, organizationId);
      if (role) {
        result.role = role;
      }
    }

    return result;
  },
  { response: { 200: MeResponseSchema } },
);
