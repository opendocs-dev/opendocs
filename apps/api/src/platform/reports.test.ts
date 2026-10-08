import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import {
  BASE_URL,
  cleanDatabase,
  GITHUB_ACCOUNT,
  realFetch,
  signIn,
  type App,
} from '../../test/helpers';
import { getPrisma } from '../db';
import { createApp } from '../index';
import { LocalDiskProvider } from '../storage/local';
import { _resetRateLimitsForTesting } from './reports';

const prisma = getPrisma();

const newApp = async (): Promise<App> => {
  const root = await mkdtemp(join(tmpdir(), 'od-reports-test-'));
  return createApp(async () => {}, {
    provider: new LocalDiskProvider(root),
    accounts: ['local'],
  });
};

beforeEach(async () => {
  await cleanDatabase();
});

afterEach(async () => {
  globalThis.fetch = realFetch;
});

afterAll(async () => {
  await cleanDatabase();
});

test('public endpoint creates abuse report and links flow/tenant if present', async () => {
  const app = await newApp();

  // Create an org and a flow
  const org = await prisma.organization.create({
    data: { id: 'org-test-1', name: 'Spamly', slug: 'spamly' },
  });
  const flow = await prisma.flow.create({
    data: {
      id: 'flow-test-1',
      publicId: 'flow-pub-1',
      organizationId: org.id,
      title: 'Claim Prize',
      slug: 'claim-prize',
      visibility: 'published',
    },
  });

  // Submit valid report
  const response = await app.handle(
    new Request(`${BASE_URL}/api/v1/public/reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reason: 'phishing',
        guide_url: 'spamly.example.com/g/claim-prize',
        text: 'A guide asks readers to enter a card number on another site.',
        reporter_email: 'reader@example.com',
      }),
    }),
  );

  expect(response.status).toBe(200);
  const body = (await response.json()) as { ok: boolean; id: string; status: string };
  expect(body.ok).toBe(true);
  expect(body.status).toBe('new');

  // Verify DB record
  const saved = await prisma.report.findUnique({ where: { id: body.id } });
  expect(saved).not.toBeNull();
  expect(saved?.type).toBe('phishing');
  expect(saved?.status).toBe('new');
  expect(saved?.organizationId).toBe(org.id);
  expect(saved?.flowId).toBe(flow.id);
  expect(saved?.guideSlug).toBe('claim-prize');
  expect(saved?.tenantName).toBe('Spamly');
  expect(saved?.reporterEmail).toBe('reader@example.com');
  expect(saved?.reporterEmailRevealedAt).toBeNull();
});

test('public report submission validates required fields', async () => {
  const app = await newApp();

  // Missing guide_url
  const res1 = await app.handle(
    new Request(`${BASE_URL}/api/v1/public/reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Some report text here' }),
    }),
  );
  expect(res1.status).toBe(422);

  // Short text (< 10 chars)
  const res2 = await app.handle(
    new Request(`${BASE_URL}/api/v1/public/reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ guide_url: 'foo/bar', text: '123456789' }),
    }),
  );
  expect(res2.status).toBe(422);

  // Text too long (> 1000 chars)
  const res3 = await app.handle(
    new Request(`${BASE_URL}/api/v1/public/reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ guide_url: 'foo/bar', text: 'a'.repeat(1001) }),
    }),
  );
  expect(res3.status).toBe(422);

  // Invalid email format
  const res4 = await app.handle(
    new Request(`${BASE_URL}/api/v1/public/reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        guide_url: 'foo/bar',
        text: 'This is valid report text.',
        reporter_email: 'not-an-email',
      }),
    }),
  );
  expect(res4.status).toBe(422);

  // Valid text (min 10 chars) and valid optional email
  const res5 = await app.handle(
    new Request(`${BASE_URL}/api/v1/public/reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        guide_url: 'foo/bar',
        text: '0123456789',
        reporter_email: 'valid@example.com',
      }),
    }),
  );
  expect(res5.status).toBe(200);

  // Valid text (max 1000 chars) without email
  const res6 = await app.handle(
    new Request(`${BASE_URL}/api/v1/public/reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        guide_url: 'foo/bar',
        text: 'b'.repeat(1000),
      }),
    }),
  );
  expect(res6.status).toBe(200);
});

test('public report submission honeypot field discards spam without DB write', async () => {
  const app = await newApp();

  const countBefore = await prisma.report.count();

  const res = await app.handle(
    new Request(`${BASE_URL}/api/v1/public/reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        guide_url: 'foo/bar',
        text: 'Bot submission spam content here',
        website: 'https://spam-bot.site',
      }),
    }),
  );

  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean };
  expect(body.ok).toBe(true);

  // Verify no report was written to DB
  const countAfter = await prisma.report.count();
  expect(countAfter).toBe(countBefore);
});

test('public report endpoint enforces rate limit per client IP', async () => {
  _resetRateLimitsForTesting();
  const app = await newApp();
  const ip = '198.51.100.42';

  // 20 requests from the same IP should all succeed
  for (let i = 0; i < 20; i++) {
    const res = await app.handle(
      new Request(`${BASE_URL}/api/v1/public/reports`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': ip,
        },
        body: JSON.stringify({
          guide_url: 'acme/test',
          text: `Report test submission number ${i}`,
        }),
      }),
    );
    expect(res.status).toBe(200);
  }

  // 21st request from same IP is rate-limited (429)
  const rateLimitedRes = await app.handle(
    new Request(`${BASE_URL}/api/v1/public/reports`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': ip,
      },
      body: JSON.stringify({
        guide_url: 'acme/test',
        text: 'Report test submission number 21 should fail',
      }),
    }),
  );
  expect(rateLimitedRes.status).toBe(429);
  const errBody = (await rateLimitedRes.json()) as { error: { code: string; message: string } };
  expect(errBody.error.code).toBe('quota_exceeded');

  // Request from a different IP still succeeds
  const differentIpRes = await app.handle(
    new Request(`${BASE_URL}/api/v1/public/reports`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.99',
      },
      body: JSON.stringify({
        guide_url: 'acme/test',
        text: 'Report from another IP succeeds cleanly',
      }),
    }),
  );
  expect(differentIpRes.status).toBe(200);

  _resetRateLimitsForTesting();
});

test('platform reports authentication & role guards', async () => {
  const app = await newApp();

  // 401 without session
  const res401 = await app.handle(new Request(`${BASE_URL}/api/v1/platform/reports`));
  expect(res401.status).toBe(401);

  // 403 for non-staff
  const cookie = await signIn(app);
  const res403 = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/reports`, { headers: { cookie } }),
  );
  expect(res403.status).toBe(403);
});

test('staff list reports with counts, filtering, and masked reporter emails', async () => {
  const app = await newApp();
  const cookie = await signIn(app);
  await prisma.user.updateMany({
    where: { email: GITHUB_ACCOUNT.email! },
    data: { staffRole: 'support' },
  });

  // Seed sample reports
  await prisma.report.createMany({
    data: [
      {
        id: 'rep-1',
        type: 'phishing',
        status: 'new',
        guideAddress: 'free-money.example/g/claim-prize',
        text: 'A guide asks readers to enter a card number on another site.',
        tenantName: 'Spamly',
        reporterEmail: 'reader1@example.com',
      },
      {
        id: 'rep-2',
        type: 'personal_data',
        status: 'in_review',
        guideAddress: 'acme.opendocs.xxx/g/top-up-balance',
        text: 'Exposed credentials in screenshot.',
        tenantName: 'Acme Help',
        reporterEmail: 'reader2@example.com',
      },
      {
        id: 'rep-3',
        type: 'copyright',
        status: 'actioned',
        guideAddress: 'northwind.opendocs.xxx/g/logo-pack',
        text: 'Copyright infringement.',
        tenantName: 'Northwind Docs',
        reporterEmail: 'reader3@example.com',
      },
    ],
  });

  // Fetch all reports
  const resAll = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/reports`, { headers: { cookie } }),
  );
  expect(resAll.status).toBe(200);
  const bodyAll = (await resAll.json()) as {
    reports: Array<{
      id: string;
      type: string;
      status: string;
      reporter_email: string | null;
      reporter_email_masked: string | null;
      reporter_email_revealed: boolean;
    }>;
    counts: { new: number; in_review: number; actioned: number; dismissed: number; total: number };
  };

  expect(bodyAll.counts.new).toBe(1);
  expect(bodyAll.counts.in_review).toBe(1);
  expect(bodyAll.counts.actioned).toBe(1);
  expect(bodyAll.counts.total).toBe(3);
  expect(bodyAll.reports.length).toBe(3);

  // Email is masked by default
  const rep1 = bodyAll.reports.find((r) => r.id === 'rep-1');
  expect(rep1?.reporter_email).toBeNull();
  expect(rep1?.reporter_email_revealed).toBe(false);
  expect(rep1?.reporter_email_masked).toBe('r***@example.com');

  // Filter by status=new
  const resNew = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/reports?status=new`, { headers: { cookie } }),
  );
  const bodyNew = (await resNew.json()) as { reports: Array<{ id: string }> };
  expect(bodyNew.reports.length).toBe(1);
  expect(bodyNew.reports[0].id).toBe('rep-1');
});

test('staff can view detail, change status, add notes, and reveal email (with audit logging)', async () => {
  const app = await newApp();
  const cookie = await signIn(app);
  await prisma.user.updateMany({
    where: { email: GITHUB_ACCOUNT.email! },
    data: { staffRole: 'support' },
  });

  const report = await prisma.report.create({
    data: {
      type: 'phishing',
      status: 'new',
      guideAddress: 'spamly.example.com/g/claim-prize',
      text: 'Suspicious card entry prompt.',
      reporterEmail: 'victim@example.com',
    },
  });

  // GET detail
  const resDetail = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/reports/${report.id}`, { headers: { cookie } }),
  );
  expect(resDetail.status).toBe(200);

  // PATCH status to in_review
  const resStatus = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/reports/${report.id}/status`, {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'in_review' }),
    }),
  );
  expect(resStatus.status).toBe(200);
  const afterStatus = await prisma.report.findUnique({ where: { id: report.id } });
  expect(afterStatus?.status).toBe('in_review');

  // POST note
  const resNote = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/reports/${report.id}/notes`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ note: 'Investigating tenant registration history.' }),
    }),
  );
  expect(resNote.status).toBe(200);
  const afterNote = await prisma.report.findUnique({ where: { id: report.id } });
  expect(afterNote?.notes).toBe('Investigating tenant registration history.');

  // POST reveal-email
  const resReveal = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/reports/${report.id}/reveal-email`, {
      method: 'POST',
      headers: { cookie },
    }),
  );
  expect(resReveal.status).toBe(200);
  const revealBody = (await resReveal.json()) as { reporter_email: string; ok: boolean };
  expect(revealBody.reporter_email).toBe('victim@example.com');

  // Check audit log contains entries
  const logs = await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' } });
  expect(logs.some((l) => l.action.includes('status'))).toBe(true);
  expect(logs.some((l) => l.action.includes('note'))).toBe(true);
  expect(logs.some((l) => l.action.includes('revealed reporter email'))).toBe(true);
});

test('support cannot unpublish or suspend; admin can unpublish guide and suspend tenant', async () => {
  const app = await newApp();
  const cookie = await signIn(app);

  const org = await prisma.organization.create({
    data: { id: 'org-bad', name: 'BadOrg', slug: 'badorg' },
  });
  const flow = await prisma.flow.create({
    data: {
      id: 'flow-bad',
      publicId: 'flow-bad-pub',
      organizationId: org.id,
      title: 'Bad Guide',
      slug: 'bad-guide',
      visibility: 'published',
    },
  });
  const report = await prisma.report.create({
    data: {
      type: 'phishing',
      status: 'new',
      organizationId: org.id,
      flowId: flow.id,
      guideSlug: flow.slug,
      tenantSlug: org.slug,
      guideAddress: 'badorg.example.com/g/bad-guide',
      text: 'Phishing attack',
    },
  });

  // 1. Support role tries unpublish and suspend -> 403
  await prisma.user.updateMany({
    where: { email: GITHUB_ACCOUNT.email! },
    data: { staffRole: 'support' },
  });

  const resUnpub403 = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/reports/${report.id}/actions/unpublish`, {
      method: 'POST',
      headers: { cookie },
    }),
  );
  expect(resUnpub403.status).toBe(403);

  const resSuspend403 = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/reports/${report.id}/actions/suspend`, {
      method: 'POST',
      headers: { cookie },
    }),
  );
  expect(resSuspend403.status).toBe(403);

  // 2. Promote user to admin
  await prisma.user.updateMany({
    where: { email: GITHUB_ACCOUNT.email! },
    data: { staffRole: 'admin' },
  });

  // Admin executes unpublish
  const resUnpub = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/reports/${report.id}/actions/unpublish`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Confirmed credential harvesting' }),
    }),
  );
  expect(resUnpub.status).toBe(200);

  // Flow is now draft (unpublished)
  const afterFlow = await prisma.flow.findUnique({ where: { id: flow.id } });
  expect(afterFlow?.visibility).toBe('draft');

  // Verify unpublished guide returns 404 from public reader endpoint
  const publicGuideRes = await app.handle(
    new Request(`${BASE_URL}/api/v1/site/tenants/${org.slug}/flows/${flow.slug}`),
  );
  expect(publicGuideRes.status).toBe(404);

  // Report is actioned
  const afterReport = await prisma.report.findUnique({ where: { id: report.id } });
  expect(afterReport?.status).toBe('actioned');

  // Admin executes suspend
  const resSuspend = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/reports/${report.id}/actions/suspend`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Malicious workspace' }),
    }),
  );
  expect(resSuspend.status).toBe(200);

  // Org is now suspended
  const afterOrg = await prisma.organization.findUnique({ where: { id: org.id } });
  expect(afterOrg?.suspendedAt).not.toBeNull();
});

test('staff can dismiss a report', async () => {
  const app = await newApp();
  const cookie = await signIn(app);
  await prisma.user.updateMany({
    where: { email: GITHUB_ACCOUNT.email! },
    data: { staffRole: 'support' },
  });

  const report = await prisma.report.create({
    data: {
      type: 'spam',
      status: 'new',
      guideAddress: 'good.example.com/g/guide',
      text: 'False alarm spam report',
    },
  });

  const resDismiss = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/reports/${report.id}/actions/dismiss`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Legitimate documentation' }),
    }),
  );
  expect(resDismiss.status).toBe(200);

  const afterReport = await prisma.report.findUnique({ where: { id: report.id } });
  expect(afterReport?.status).toBe('dismissed');

  const log = await prisma.auditLog.findFirst({
    where: { action: 'Staff dismissed report' },
  });
  expect(log).not.toBeNull();
});
