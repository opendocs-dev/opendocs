import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { BASE_URL, cleanDatabase, GITHUB_ACCOUNT, realFetch, signIn, type App } from '../../test/helpers';
import { getPrisma } from '../db';
import { LocalDiskProvider } from '../storage/local';

const cnameAnswers = new Map<string, string[]>();
mock.module('node:dns', () => ({
  default: {
    promises: {
      resolveCname: async (hostname: string) => {
        const answer = cnameAnswers.get(hostname);
        if (!answer) throw new Error('ENODATA');
        return answer;
      },
    },
  },
}));

const { createApp } = await import('../index');

const prisma = getPrisma();

const newApp = async (): Promise<App> => {
  const root = await mkdtemp(join(tmpdir(), 'od-domains-test-'));
  return createApp(async () => {}, {
    provider: new LocalDiskProvider(root),
    accounts: ['local'],
  });
};

const getDomains = (app: App, cookie = '', query = '') =>
  app.handle(
    new Request(`${BASE_URL}/api/v1/platform/domains${query}`, {
      headers: cookie ? { cookie } : {},
    }),
  );

const recheckDomain = (app: App, cookie: string, domain: string) =>
  app.handle(
    new Request(`${BASE_URL}/api/v1/platform/domains/${encodeURIComponent(domain)}/recheck`, {
      method: 'POST',
      headers: { cookie },
    }),
  );

const blockDomain = (app: App, cookie: string, domain: string, body: unknown) =>
  app.handle(
    new Request(`${BASE_URL}/api/v1/platform/domains/${encodeURIComponent(domain)}/block`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    }),
  );

const unblockDomain = (app: App, cookie: string, domain: string, body: unknown) =>
  app.handle(
    new Request(`${BASE_URL}/api/v1/platform/domains/${encodeURIComponent(domain)}/unblock`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    }),
  );

const resolve = (app: App, query: string) =>
  app.handle(new Request(`${BASE_URL}/api/v1/site/resolve?${query}`));

beforeEach(async () => {
  await cleanDatabase();
  cnameAnswers.clear();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.PLATFORM_ADMIN_EMAILS;
  delete process.env.TENANT_BASE_DOMAIN;
  cnameAnswers.clear();
});

afterAll(async () => {
  await cleanDatabase();
});

test('GET /api/v1/platform/domains requires authentication and staff access', async () => {
  const app = await newApp();

  // Anonymous -> 401
  const anon = await getDomains(app);
  expect(anon.status).toBe(401);

  // Normal user -> 403
  const cookie = await signIn(app);
  const userRes = await getDomains(app, cookie);
  expect(userRes.status).toBe(403);
});

test('GET /api/v1/platform/domains returns custom domains with tenant details and filter=attention works', async () => {
  const app = await newApp();
  const cookie = await signIn(app);

  await prisma.user.updateMany({
    where: { email: GITHUB_ACCOUNT.email! },
    data: { staffRole: 'support' },
  });

  // Clean orgs from signIn
  await prisma.organization.deleteMany();

  const org1 = await prisma.organization.create({
    data: {
      id: 'org-acme',
      name: 'Acme Help',
      slug: 'acme',
      site: {
        create: {
          siteTitle: 'Acme Help',
          customDomain: 'docs.example.com',
          domainStatus: 'verified',
          certExpiresAt: new Date('2026-12-28T00:00:00Z'),
          lastCheckedAt: new Date(),
        },
      },
    },
  });

  const org2 = await prisma.organization.create({
    data: {
      id: 'org-northwind',
      name: 'Northwind Docs',
      slug: 'northwind',
      site: {
        create: {
          siteTitle: 'Northwind Docs',
          customDomain: 'help.northwind.example',
          domainStatus: 'waiting_dns',
          lastCheckedAt: new Date(),
        },
      },
    },
  });

  const org3 = await prisma.organization.create({
    data: {
      id: 'org-spamly',
      name: 'Spamly',
      slug: 'spamly',
      site: {
        create: {
          siteTitle: 'Spamly',
          customDomain: 'free-money.example',
          domainStatus: 'blocked',
          lastCheckedAt: new Date('2026-09-27T00:00:00Z'),
        },
      },
    },
  });

  // List all
  const resAll = await getDomains(app, cookie);
  expect(resAll.status).toBe(200);
  const bodyAll = (await resAll.json()) as { domains: Array<{ domain: string; status: string; tenant: { name: string; slug: string } }>; total: number };
  expect(bodyAll.total).toBe(3);
  expect(bodyAll.domains.length).toBe(3);

  // Check row content
  const pfn = bodyAll.domains.find((d) => d.domain === 'docs.example.com');
  expect(pfn).toBeDefined();
  expect(pfn?.tenant.name).toBe('Acme Help');
  expect(pfn?.tenant.slug).toBe('acme');
  expect(pfn?.status).toBe('verified');

  // Filter attention
  const resAtt = await getDomains(app, cookie, '?filter=attention');
  expect(resAtt.status).toBe(200);
  const bodyAtt = (await resAtt.json()) as { domains: Array<{ domain: string; status: string }>; total: number };
  expect(bodyAtt.domains.length).toBe(2);
  const attDomains = bodyAtt.domains.map((d) => d.domain);
  expect(attDomains).toContain('help.northwind.example');
  expect(attDomains).toContain('free-money.example');
  expect(attDomains).not.toContain('docs.example.com');
});

test('POST /api/v1/platform/domains/:domain/recheck updates status and last check', async () => {
  const app = await newApp();
  const cookie = await signIn(app);

  await prisma.user.updateMany({
    where: { email: GITHUB_ACCOUNT.email! },
    data: { staffRole: 'support' },
  });

  process.env.TENANT_BASE_DOMAIN = 'opendocs.xxx';

  const org = await prisma.organization.create({
    data: {
      id: 'org-test',
      name: 'Test Org',
      slug: 'test-org',
      site: {
        create: {
          siteTitle: 'Test Org',
          customDomain: 'docs.test.example',
          domainStatus: 'waiting_dns',
          lastCheckedAt: new Date('2026-01-01T00:00:00Z'),
        },
      },
    },
  });

  // CNAME points to test-org.opendocs.xxx
  cnameAnswers.set('docs.test.example', ['test-org.opendocs.xxx']);

  const response = await recheckDomain(app, cookie, 'docs.test.example');
  expect(response.status).toBe(200);
  const body = (await response.json()) as { domain: string; status: string; last_checked_at: string };
  expect(body.status).toBe('verified');
  expect(new Date(body.last_checked_at).getTime()).toBeGreaterThan(new Date('2026-01-01T00:00:00Z').getTime());

  const updatedSite = await prisma.workspaceSite.findUniqueOrThrow({ where: { organizationId: org.id } });
  expect(updatedSite.domainStatus).toBe('verified');
  expect(updatedSite.lastCheckedAt).not.toBeNull();
});

test('support role cannot block or unblock; admin role can block and unblock with audit logging', async () => {
  const app = await newApp();
  const cookie = await signIn(app);

  const org = await prisma.organization.create({
    data: {
      id: 'org-acme',
      name: 'Acme',
      slug: 'acme-corp',
      site: {
        create: {
          siteTitle: 'Acme',
          customDomain: 'docs.acme.example',
          domainStatus: 'verified',
        },
      },
    },
  });

  // 1. Support role cannot block
  await prisma.user.updateMany({
    where: { email: GITHUB_ACCOUNT.email! },
    data: { staffRole: 'support' },
  });

  const supportBlock = await blockDomain(app, cookie, 'docs.acme.example', { reason: 'Phishing' });
  expect(supportBlock.status).toBe(403);

  const supportUnblock = await unblockDomain(app, cookie, 'docs.acme.example', { reason: 'Resolved' });
  expect(supportUnblock.status).toBe(403);

  // 2. Admin role can block
  await prisma.user.updateMany({
    where: { email: GITHUB_ACCOUNT.email! },
    data: { staffRole: 'admin' },
  });

  // Reason is required
  const noReason = await blockDomain(app, cookie, 'docs.acme.example', { reason: '   ' });
  expect(noReason.status).toBe(422);

  // Successful block
  const adminBlock = await blockDomain(app, cookie, 'docs.acme.example', { reason: 'Confirmed phishing domain' });
  expect(adminBlock.status).toBe(200);
  const blockBody = (await adminBlock.json()) as { ok: boolean; status: string };
  expect(blockBody.ok).toBe(true);
  expect(blockBody.status).toBe('blocked');

  let site = await prisma.workspaceSite.findUniqueOrThrow({ where: { organizationId: org.id } });
  expect(site.domainStatus).toBe('blocked');

  // Verify audit log for block
  const blockAudit = await prisma.auditLog.findFirst({
    where: { organizationId: org.id, action: { contains: 'blocked domain docs.acme.example' } },
  });
  expect(blockAudit).not.toBeNull();
  expect(blockAudit?.actorKind).toBe('staff');
  expect((blockAudit?.detail as { reason: string }).reason).toBe('Confirmed phishing domain');

  // Recheck on blocked domain preserves blocked status
  process.env.TENANT_BASE_DOMAIN = 'opendocs.xxx';
  cnameAnswers.set('docs.acme.example', ['acme-corp.opendocs.xxx']);
  const recheckBlocked = await recheckDomain(app, cookie, 'docs.acme.example');
  expect(recheckBlocked.status).toBe(200);
  expect(((await recheckBlocked.json()) as { status: string }).status).toBe('blocked');

  // 3. Admin can unblock
  const adminUnblock = await unblockDomain(app, cookie, 'docs.acme.example', { reason: 'False positive cleared' });
  expect(adminUnblock.status).toBe(200);
  const unblockBody = (await adminUnblock.json()) as { ok: boolean; status: string };
  expect(unblockBody.ok).toBe(true);
  expect(unblockBody.status).toBe('verified');

  site = await prisma.workspaceSite.findUniqueOrThrow({ where: { organizationId: org.id } });
  expect(site.domainStatus).toBe('verified');

  // Verify audit log for unblock
  const unblockAudit = await prisma.auditLog.findFirst({
    where: { organizationId: org.id, action: { contains: 'unblocked domain docs.acme.example' } },
  });
  expect(unblockAudit).not.toBeNull();
  expect((unblockAudit?.detail as { reason: string }).reason).toBe('False positive cleared');
});

test('blocked domain returns not found on that host only, while tenant address keeps working', async () => {
  const app = await newApp();
  const cookie = await signIn(app);

  await prisma.user.updateMany({
    where: { email: GITHUB_ACCOUNT.email! },
    data: { staffRole: 'admin' },
  });

  const org = await prisma.organization.create({
    data: {
      id: 'org-spamly-inc',
      name: 'Spamly Inc',
      slug: 'spamly-help',
      site: {
        create: {
          siteTitle: 'Spamly Inc',
          customDomain: 'free-money.example',
          domainStatus: 'verified',
        },
      },
    },
  });

  // Initially verified domain resolves
  const initialDomainResolve = await resolve(app, 'domain=free-money.example');
  expect(await initialDomainResolve.json()).toEqual({ status: 'active', slug: 'spamly-help' });

  const initialTenantResolve = await resolve(app, 'slug=spamly-help');
  expect(await initialTenantResolve.json()).toEqual({ status: 'active' });

  // Now block the custom domain
  const blockRes = await blockDomain(app, cookie, 'free-money.example', { reason: 'Spam detected' });
  expect(blockRes.status).toBe(200);

  // Blocked custom domain returns missing (not found) on that host
  const blockedDomainResolve = await resolve(app, 'domain=free-money.example');
  expect(await blockedDomainResolve.json()).toEqual({ status: 'missing' });

  const blockedHostFallbackResolve = await resolve(app, 'slug=free-money.example');
  expect(await blockedHostFallbackResolve.json()).toEqual({ status: 'missing' });

  // BUT the tenant address keeps working!
  const tenantResolve = await resolve(app, 'slug=spamly-help');
  expect(await tenantResolve.json()).toEqual({ status: 'active' });
});
