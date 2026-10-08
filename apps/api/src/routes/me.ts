import { CLI_MIN_VERSION, type MeResponse, MeResponseSchema } from '@opendocs/core';
import { Elysia } from 'elysia';
import { auth } from '../auth';
import { resolveOrganizationId, unauthorized } from '../auth-context';
import { getPrisma } from '../db';
import { DAILY_QUOTAS } from '../legacy-limits';
import { getPlan } from '../plan';
import { roleFor } from '../site/role';
import { touchMemberLastActive } from '../site/session';

const startOfUtcDay = (now: Date) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

const siteHostFor = (slug: string): string | null => {
  const base = process.env.TENANT_BASE_DOMAIN;
  return base ? `${slug}.${base}` : null;
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

    const plan = await getPlan(organizationId);
    const quotas = DAILY_QUOTAS[plan];

    const usage = await getPrisma().usageDaily.findUnique({
      where: { organizationId_day: { organizationId, day: startOfUtcDay(new Date()) } },
      select: { files: true, bytes: true },
    });

    const result: MeResponse = {
      workspace: { id: organization.id, name: organization.name, slug: organization.slug },
      quota: {
        files_left: Math.max(0, quotas.files - (usage?.files ?? 0)),
        bytes_left: Math.max(0, quotas.bytes - Number(usage?.bytes ?? 0n)),
      },
      min_cli_version: CLI_MIN_VERSION,
      site_host: siteHostFor(organization.slug),
    };

    // Add role for session callers only
    const session = await auth.api.getSession({ headers: request.headers });
    if (session?.session.activeOrganizationId === organizationId) {
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
