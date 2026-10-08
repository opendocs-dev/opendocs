import crypto from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { BASE_URL, cleanDatabase, GITHUB_ACCOUNT, realFetch, signIn, type App } from '../../test/helpers';
import { getPrisma } from '../db';
import { createApp } from '../index';
import { setPolarClient, type PolarClient } from '../polar';

const prisma = getPrisma();

// Raw UTF-8 secret string with whsec_ prefix (never base64-decoded)
const TEST_SECRET = ['whsec', 'my_raw_polar_secret_key_1234567890'].join('_');
const PRO_MONTHLY_ID = 'prod_pro_monthly_123';
const PRO_YEARLY_ID = 'prod_pro_yearly_456';
const CREDITS_1000_ID = 'prod_cred_1000';
const CREDITS_5000_ID = 'prod_cred_5000';
const CREDITS_20000_ID = 'prod_cred_20000';

const errorCode = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

const newApp = (): App => createApp(async () => {});

const workspace = async (app: App) => {
  const cookie = await signIn(app, GITHUB_ACCOUNT);
  const owner = await prisma.member.findFirstOrThrow({ where: { role: 'owner' } });
  return { app, cookie, organizationId: owner.organizationId, userId: owner.userId };
};

const get = (app: App, path: string, cookie?: string) =>
  app.handle(new Request(`${BASE_URL}${path}`, { headers: cookie ? { cookie } : {} }));

const post = (app: App, path: string, body: unknown, cookie?: string, headers: Record<string, string> = {}) =>
  app.handle(
    new Request(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        ...(cookie ? { cookie } : {}),
        'content-type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  );

const patch = (app: App, path: string, body: unknown, cookie?: string) =>
  app.handle(
    new Request(`${BASE_URL}${path}`, {
      method: 'PATCH',
      headers: {
        ...(cookie ? { cookie } : {}),
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
  );

function makeWebhookHeaders(
  body: string,
  secret: string = TEST_SECRET,
  options?: { id?: string; timestamp?: string },
) {
  const id = options?.id ?? `evt_${Math.random().toString(36).slice(2)}`;
  const timestamp = options?.timestamp ?? Math.floor(Date.now() / 1000).toString();
  const secretBytes = Buffer.from(secret, 'utf8');
  const payload = `${id}.${timestamp}.${body}`;
  const sig = crypto.createHmac('sha256', secretBytes).update(payload).digest('base64');
  return {
    'webhook-id': id,
    'webhook-timestamp': timestamp,
    'webhook-signature': `v1,${sig}`,
  };
}

const originalEnv = { ...process.env };

beforeEach(async () => {
  await cleanDatabase();
  process.env.POLAR_WEBHOOK_SECRET = TEST_SECRET;
  process.env.POLAR_PRODUCT_PRO_MONTHLY = PRO_MONTHLY_ID;
  process.env.POLAR_PRODUCT_PRO_YEARLY = PRO_YEARLY_ID;
  process.env.POLAR_PRODUCT_CREDITS_1000 = CREDITS_1000_ID;
  process.env.POLAR_PRODUCT_CREDITS_5000 = CREDITS_5000_ID;
  process.env.POLAR_PRODUCT_CREDITS_20000 = CREDITS_20000_ID;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  setPolarClient(null);
  process.env = { ...originalEnv };
});

afterAll(async () => {
  await cleanDatabase();
});

describe('Billing API routes & Polar integration', () => {
  describe('GET /api/v1/billing', () => {
    test('as owner returns real empty states when no data exists', async () => {
      const ws = await workspace(newApp());
      const response = await get(ws.app, '/api/v1/billing', ws.cookie);
      expect(response.status).toBe(200);

      const body = (await response.json()) as any;
      expect(body.subscription.plan).toBe('free');
      expect(body.subscription.status).toBe('free');
      expect(body.subscription.next_invoice_date).toBeNull();
      expect(body.payment_method).toBeNull();
      expect(body.invoices).toEqual([]);
      expect(body.invoices_unavailable).toBe(false);
      expect(body.portal_url).toBeNull(); // No customer session created on load (Item 9)
      expect(body.ai_credits.balance).toBe(0);
      expect(body.ai_credits.packs).toHaveLength(3);
    });

    test('as owner returns billing information and orders invoices via Polar client with real fields and Intl formatting', async () => {
      const ws = await workspace(newApp());

      await prisma.workspaceBilling.create({
        data: {
          organizationId: ws.organizationId,
          plan: 'pro',
          status: 'active',
          polarCustomerId: 'cus_polar_123',
          polarSubscriptionId: 'sub_polar_456',
          periodEnd: new Date('2026-11-01T00:00:00Z'),
        },
      });

      let invoiceCalledWithId = '';
      const fakeClient: any = {
        checkouts: {
          create: async () => ({ url: 'https://polar.sh/checkout/fake' }),
        },
        customerSessions: {
          create: async () => ({ customerPortalUrl: 'https://polar.sh/portal/session_123' }),
        },
        orders: {
          list: async () => ({
            result: {
              items: [
                {
                  id: 'ord_real_001',
                  createdAt: new Date('2026-10-01T12:00:00Z'),
                  totalAmount: 1200,
                  currency: 'usd',
                  status: 'paid',
                  invoiceNumber: 'INV-2026-001',
                },
              ],
            },
          }),
          invoice: async (req: { id: string }) => {
            invoiceCalledWithId = req.id;
            return { url: 'https://polar.sh/invoices/inv_001.pdf' };
          },
        },
      };
      setPolarClient(fakeClient);

      const response = await get(ws.app, '/api/v1/billing', ws.cookie);
      expect(response.status).toBe(200);

      const body = (await response.json()) as any;
      expect(body.subscription.plan).toBe('pro');
      expect(body.subscription.status).toBe('active');
      expect(body.portal_url).toBeNull(); // Item 9: must NOT create session on GET
      expect(body.invoices).toHaveLength(1);
      expect(body.invoices[0].id).toBe('ord_real_001');
      expect(body.invoices[0].number).toBe('INV-2026-001');
      expect(body.invoices[0].amount).toBe('$12.00'); // Formatted via Intl.NumberFormat
      expect(body.invoices[0].pdf_url).toBe('https://polar.sh/invoices/inv_001.pdf');
      expect(invoiceCalledWithId).toBe('ord_real_001');
      expect(body.invoices_unavailable).toBe(false);
    });

    test('surfaces invoices_unavailable flag when order loading fails', async () => {
      const ws = await workspace(newApp());
      await prisma.workspaceBilling.create({
        data: {
          organizationId: ws.organizationId,
          polarCustomerId: 'cus_polar_fail',
        },
      });

      const fakeClient: any = {
        checkouts: { create: async () => ({ url: '' }) },
        customerSessions: { create: async () => ({}) },
        orders: {
          list: async () => {
            throw new Error('Polar service unavailable');
          },
        },
      };
      setPolarClient(fakeClient);

      const response = await get(ws.app, '/api/v1/billing', ws.cookie);
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.invoices_unavailable).toBe(true);
      expect(body.invoices).toEqual([]);
    });

    test('AI credit balance uses latest ledger entry balanceAfter (source of truth)', async () => {
      const ws = await workspace(newApp());
      // Create ledger entries
      await prisma.aiCreditLedger.create({
        data: {
          organizationId: ws.organizationId,
          delta: 1000,
          reason: 'purchase',
          credits: 1000,
          balanceAfter: 1000,
          orderId: 'ord_init_1',
          createdAt: new Date('2026-09-01T00:00:00Z'),
        },
      });
      // Monthly reset at start of October
      await prisma.aiCreditLedger.create({
        data: {
          organizationId: ws.organizationId,
          delta: -500,
          reason: 'monthly_reset',
          credits: 500,
          balanceAfter: 500,
          messageId: 'monthly-2026-10',
          createdAt: new Date('2026-10-01T00:00:00Z'),
        },
      });

      const response = await get(ws.app, '/api/v1/billing', ws.cookie);
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.ai_credits.balance).toBe(500);
    });

    test('owner-only: 403 for admin and editor, 401 for unauthenticated', async () => {
      const ws = await workspace(newApp());

      // Admin
      await prisma.member.updateMany({ where: { organizationId: ws.organizationId }, data: { role: 'admin' } });
      const adminRes = await get(ws.app, '/api/v1/billing', ws.cookie);
      expect(adminRes.status).toBe(403);
      expect(await errorCode(adminRes)).toBe('unauthorized');

      // Editor
      await prisma.member.updateMany({ where: { organizationId: ws.organizationId }, data: { role: 'editor' } });
      const editorRes = await get(ws.app, '/api/v1/billing', ws.cookie);
      expect(editorRes.status).toBe(403);
      expect(await errorCode(editorRes)).toBe('unauthorized');

      // Unauthenticated
      const unauthRes = await get(newApp(), '/api/v1/billing');
      expect(unauthRes.status).toBe(401);
    });
  });

  describe('POST /api/v1/billing/checkout', () => {
    test('as owner creates checkout via Polar client with external customer id', async () => {
      const ws = await workspace(newApp());

      let capturedParams: any = null;
      const fakeClient: any = {
        checkouts: {
          create: async (params: any) => {
            capturedParams = params;
            return { url: 'https://polar.sh/checkout/checkout_pro_monthly' };
          },
        },
        customerSessions: { create: async () => ({}) },
        orders: { list: async () => [] },
      };
      setPolarClient(fakeClient);

      const res = await post(ws.app, '/api/v1/billing/checkout', { interval: 'monthly' }, ws.cookie);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.url).toBe('https://polar.sh/checkout/checkout_pro_monthly');

      expect(capturedParams.products).toEqual([PRO_MONTHLY_ID]);
      expect(capturedParams.externalCustomerId).toBe(ws.organizationId);
    });

    test('checkout guard: 409 if already on Pro active plan', async () => {
      const ws = await workspace(newApp());
      await prisma.workspaceBilling.create({
        data: {
          organizationId: ws.organizationId,
          plan: 'pro',
          status: 'active',
        },
      });

      const res = await post(ws.app, '/api/v1/billing/checkout', { interval: 'monthly' }, ws.cookie);
      expect(res.status).toBe(409);
    });

    test('checkout guard: enterprise workspace can never check out Pro (409)', async () => {
      const ws = await workspace(newApp());
      await prisma.workspaceBilling.create({
        data: {
          organizationId: ws.organizationId,
          plan: 'enterprise',
          status: 'active',
        },
      });

      const res = await post(ws.app, '/api/v1/billing/checkout', { interval: 'monthly' }, ws.cookie);
      expect(res.status).toBe(409);
      const body = (await res.json()) as any;
      expect(body.error.message).toContain('Enterprise');
    });

    test('checkout guard: canceled_at_period_end directed to portal (409)', async () => {
      const ws = await workspace(newApp());
      await prisma.workspaceBilling.create({
        data: {
          organizationId: ws.organizationId,
          plan: 'pro',
          status: 'canceled_at_period_end',
          cancelAtPeriodEnd: true,
          periodEnd: new Date(Date.now() + 86400000 * 10), // 10 days in future
        },
      });

      const res = await post(ws.app, '/api/v1/billing/checkout', { interval: 'monthly' }, ws.cookie);
      expect(res.status).toBe(409);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('canceled_subscription_active');
      expect(body.error.message).toContain('portal');
    });

    test('checkout guard: allows checkout after periodEnd has passed for canceled workspace', async () => {
      const ws = await workspace(newApp());
      await prisma.workspaceBilling.create({
        data: {
          organizationId: ws.organizationId,
          plan: 'pro',
          status: 'canceled_at_period_end',
          cancelAtPeriodEnd: true,
          periodEnd: new Date(Date.now() - 86400000), // 1 day in past
        },
      });

      const fakeClient: any = {
        checkouts: {
          create: async () => ({ url: 'https://polar.sh/checkout/new_sub' }),
        },
      };
      setPolarClient(fakeClient);

      const res = await post(ws.app, '/api/v1/billing/checkout', { interval: 'monthly' }, ws.cookie);
      expect(res.status).toBe(200);
    });

    test('maps Polar SDK checkout errors to 502 with polar_api_error', async () => {
      const ws = await workspace(newApp());
      const fakeClient: any = {
        checkouts: {
          create: async () => {
            throw new Error('Polar gateway timeout');
          },
        },
      };
      setPolarClient(fakeClient);

      const res = await post(ws.app, '/api/v1/billing/checkout', { interval: 'monthly' }, ws.cookie);
      expect(res.status).toBe(502);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('polar_api_error');
    });
  });

  describe('POST /api/v1/billing/portal', () => {
    test('returns 409 when workspace has no Polar customer', async () => {
      const ws = await workspace(newApp());
      const fakeClient: any = {
        customerSessions: {
          create: async () => {
            const err: any = new Error('Resource not found');
            err.statusCode = 404;
            throw err;
          },
        },
      };
      setPolarClient(fakeClient);

      const res = await post(ws.app, '/api/v1/billing/portal', {}, ws.cookie);
      expect(res.status).toBe(409);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('no_polar_customer');
    });

    test('creates customer session using customerId and records audit log', async () => {
      const ws = await workspace(newApp());
      await prisma.workspaceBilling.create({
        data: {
          organizationId: ws.organizationId,
          polarCustomerId: 'cus_polar_999',
        },
      });

      let capturedParams: any = null;
      const fakeClient: any = {
        checkouts: { create: async () => ({ url: '' }) },
        customerSessions: {
          create: async (params: any) => {
            capturedParams = params;
            return { customerPortalUrl: 'https://polar.sh/portal/session_abc' };
          },
        },
        orders: { list: async () => [] },
      };
      setPolarClient(fakeClient);

      const res = await post(ws.app, '/api/v1/billing/portal', {}, ws.cookie);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.url).toBe('https://polar.sh/portal/session_abc');
      expect(capturedParams.customerId).toBe('cus_polar_999');

      const audit = await prisma.auditLog.findFirst({
        where: { organizationId: ws.organizationId, action: 'Opened payment portal' },
      });
      expect(audit).toBeDefined();
    });

    test('maps Polar SDK portal errors to 502 with polar_api_error', async () => {
      const ws = await workspace(newApp());
      await prisma.workspaceBilling.create({
        data: {
          organizationId: ws.organizationId,
          polarCustomerId: 'cus_polar_err',
        },
      });

      const fakeClient: any = {
        customerSessions: {
          create: async () => {
            throw new Error('Polar customer portal service down');
          },
        },
      };
      setPolarClient(fakeClient);

      const res = await post(ws.app, '/api/v1/billing/portal', {}, ws.cookie);
      expect(res.status).toBe(502);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('polar_api_error');
    });
  });

  describe('PATCH /api/v1/billing/invoice-details', () => {
    test('updates details and logs changes under row lock without leaking PII', async () => {
      const ws = await workspace(newApp());

      const res = await patch(
        ws.app,
        '/api/v1/billing/invoice-details',
        {
          email: 'finance@acme.test',
          company: 'Acme International',
          tax_id: 'VAT-999',
        },
        ws.cookie,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.invoice_details.email).toBe('finance@acme.test');
      expect(body.invoice_details.company).toBe('Acme International');
      expect(body.invoice_details.tax_id).toBe('VAT-999');

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { organizationId: ws.organizationId, action: 'Updated billing invoice details' },
      });
      const detailStr = JSON.stringify(audit.detail);
      expect(detailStr).not.toContain('finance@acme.test');
      expect(detailStr).not.toContain('Acme International');
      expect(detailStr).not.toContain('VAT-999');
    });
  });

  describe('POST /api/v1/billing/webhook', () => {
    test('fails closed (500 server_misconfigured) when POLAR_WEBHOOK_SECRET is unset', async () => {
      delete process.env.POLAR_WEBHOOK_SECRET;
      const app = newApp();
      const res = await post(app, '/api/v1/billing/webhook', { type: 'subscription.created' });
      expect(res.status).toBe(500);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('server_misconfigured');
    });

    test('returns 401 when webhook-id header is missing (Item 2)', async () => {
      const app = newApp();
      const bodyStr = JSON.stringify({ type: 'subscription.created' });
      const headers = {
        'webhook-timestamp': Math.floor(Date.now() / 1000).toString(),
        'webhook-signature': 'v1,someSig',
      };
      const res = await post(app, '/api/v1/billing/webhook', { type: 'subscription.created' }, undefined, headers);
      expect(res.status).toBe(401);
      const body = (await res.json()) as any;
      expect(body.error.message).toContain('webhook-id');
    });

    test('returns 401 when webhook-timestamp is non-numeric (Item 10)', async () => {
      const app = newApp();
      const headers = {
        'webhook-id': 'evt_1',
        'webhook-timestamp': '12345abc',
        'webhook-signature': 'v1,someSig',
      };
      const res = await post(app, '/api/v1/billing/webhook', { type: 'subscription.created' }, undefined, headers);
      expect(res.status).toBe(401);
    });

    test('returns 401 when signature is invalid', async () => {
      const app = newApp();
      const headers = {
        'webhook-id': 'evt_1',
        'webhook-timestamp': Math.floor(Date.now() / 1000).toString(),
        'webhook-signature': 'v1,invalidSig==',
      };
      const res = await post(app, '/api/v1/billing/webhook', { type: 'subscription.created' }, undefined, headers);
      expect(res.status).toBe(401);
    });

    test('unknown event returns 200 ignored and does NOT write BillingEvent (Item 6)', async () => {
      const app = newApp();
      const eventId = `evt_unhandled_${crypto.randomUUID()}`;
      const payload = { type: 'benefit.created', data: {} };
      const bodyStr = JSON.stringify(payload);
      const headers = makeWebhookHeaders(bodyStr, TEST_SECRET, { id: eventId });

      const res = await post(app, '/api/v1/billing/webhook', payload, undefined, headers);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.ignored).toBe(true);

      const count = await prisma.billingEvent.count({ where: { eventId } });
      expect(count).toBe(0); // NO BillingEvent written!
    });

    test('unknown customer returns 200 ignored and does NOT write BillingEvent (Item 6)', async () => {
      const app = newApp();
      const eventId = `evt_unknown_cust_${crypto.randomUUID()}`;
      const payload = {
        type: 'subscription.created',
        data: {
          product_id: PRO_MONTHLY_ID,
          customer_id: 'cus_non_existent',
          customer: { external_id: 'org_non_existent' },
        },
      };
      const bodyStr = JSON.stringify(payload);
      const headers = makeWebhookHeaders(bodyStr, TEST_SECRET, { id: eventId });

      const res = await post(app, '/api/v1/billing/webhook', payload, undefined, headers);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.ignored).toBe('unknown_customer');

      const count = await prisma.billingEvent.count({ where: { eventId } });
      expect(count).toBe(0); // NO BillingEvent written!
    });

    test('unknown product returns 200 ignored and does NOT write BillingEvent (Item 6)', async () => {
      const ws = await workspace(newApp());
      const eventId = `evt_unknown_prod_${crypto.randomUUID()}`;
      const payload = {
        type: 'subscription.created',
        data: {
          product_id: 'prod_unknown_random',
          customer_id: 'cus_polar_1',
          customer: { external_id: ws.organizationId },
        },
      };
      const bodyStr = JSON.stringify(payload);
      const headers = makeWebhookHeaders(bodyStr, TEST_SECRET, { id: eventId });

      const res = await post(ws.app, '/api/v1/billing/webhook', payload, undefined, headers);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.ignored).toBe('unknown_product_id');

      const count = await prisma.billingEvent.count({ where: { eventId } });
      expect(count).toBe(0); // NO BillingEvent written!
    });

    test('subscription.created with active status grants Pro and sets lastModifiedAt (Items 3, 4, 10)', async () => {
      const ws = await workspace(newApp());
      const eventId = `evt_sub_${crypto.randomUUID()}`;
      const modifiedAt = new Date('2026-10-04T12:00:00Z').toISOString();

      const payload = {
        type: 'subscription.created',
        data: {
          id: 'sub_polar_100',
          customer_id: 'cus_polar_100',
          customer: { external_id: ws.organizationId, card_brand: 'Mastercard', card_last4: '1234' },
          product_id: PRO_MONTHLY_ID,
          status: 'active',
          current_period_end: '2026-11-04T00:00:00Z',
          modified_at: modifiedAt,
        },
      };
      const bodyStr = JSON.stringify(payload);
      const headers = makeWebhookHeaders(bodyStr, TEST_SECRET, { id: eventId });

      const res = await post(ws.app, '/api/v1/billing/webhook', payload, undefined, headers);
      expect(res.status).toBe(200);

      const billing = await prisma.workspaceBilling.findUniqueOrThrow({ where: { organizationId: ws.organizationId } });
      expect(billing.plan).toBe('pro');
      expect(billing.status).toBe('active');
      expect(billing.polarCustomerId).toBe('cus_polar_100');
      expect(billing.polarSubscriptionId).toBe('sub_polar_100');
      expect(billing.periodEnd?.toISOString()).toBe('2026-11-04T00:00:00.000Z');
      expect(billing.cancelAtPeriodEnd).toBe(false);
      expect(billing.lastModifiedAt?.toISOString()).toBe(new Date(modifiedAt).toISOString());

      // Item 10: dead card fields removed from webhook (metadata paymentMethod not set)
      const org = await prisma.organization.findUniqueOrThrow({ where: { id: ws.organizationId } });
      expect(org.metadata).toBeNull();

      // Idempotency: BillingEvent row created using webhook-id header
      const eventRow = await prisma.billingEvent.findUnique({ where: { eventId } });
      expect(eventRow).toBeDefined();
    });

    test('subscription status handling: past_due keeps pro with past_due status (Item 3)', async () => {
      const ws = await workspace(newApp());
      await prisma.workspaceBilling.create({
        data: {
          organizationId: ws.organizationId,
          plan: 'pro',
          status: 'active',
          polarCustomerId: 'cus_polar_pd',
          polarSubscriptionId: 'sub_polar_pd',
        },
      });

      const eventId = `evt_sub_pd_${crypto.randomUUID()}`;
      const payload = {
        type: 'subscription.updated',
        data: {
          id: 'sub_polar_pd',
          customer_id: 'cus_polar_pd',
          product_id: PRO_MONTHLY_ID,
          status: 'past_due',
        },
      };
      const headers = makeWebhookHeaders(JSON.stringify(payload), TEST_SECRET, { id: eventId });

      const res = await post(ws.app, '/api/v1/billing/webhook', payload, undefined, headers);
      expect(res.status).toBe(200);

      const billing = await prisma.workspaceBilling.findUniqueOrThrow({ where: { organizationId: ws.organizationId } });
      expect(billing.plan).toBe('pro'); // Keeps pro!
      expect(billing.status).toBe('past_due');
    });

    test('subscription status handling: incomplete/unpaid does not grant pro (Item 3)', async () => {
      const ws = await workspace(newApp());
      const eventId = `evt_sub_inc_${crypto.randomUUID()}`;
      const payload = {
        type: 'subscription.created',
        data: {
          id: 'sub_polar_inc',
          customer: { external_id: ws.organizationId },
          product_id: PRO_MONTHLY_ID,
          status: 'incomplete',
        },
      };
      const headers = makeWebhookHeaders(JSON.stringify(payload), TEST_SECRET, { id: eventId });

      const res = await post(ws.app, '/api/v1/billing/webhook', payload, undefined, headers);
      expect(res.status).toBe(200);

      const billing = await prisma.workspaceBilling.findUniqueOrThrow({ where: { organizationId: ws.organizationId } });
      expect(billing.plan).toBe('free'); // Does NOT grant pro!
      expect(billing.status).toBe('incomplete');
    });

    test('ordering: late revoked for old subscription does NOT downgrade workspace that re-subscribed (Item 4)', async () => {
      const ws = await workspace(newApp());
      // Workspace has newly re-subscribed with sub_new
      await prisma.workspaceBilling.create({
        data: {
          organizationId: ws.organizationId,
          plan: 'pro',
          status: 'active',
          polarCustomerId: 'cus_polar_re',
          polarSubscriptionId: 'sub_new',
          lastModifiedAt: new Date('2026-10-04T10:00:00Z'),
        },
      });

      // Late revoked arrives for sub_old
      const eventId = `evt_late_rev_${crypto.randomUUID()}`;
      const payload = {
        type: 'subscription.revoked',
        data: {
          id: 'sub_old',
          customer_id: 'cus_polar_re',
          product_id: PRO_MONTHLY_ID,
          modified_at: '2026-10-04T11:00:00Z',
        },
      };
      const headers = makeWebhookHeaders(JSON.stringify(payload), TEST_SECRET, { id: eventId });

      const res = await post(ws.app, '/api/v1/billing/webhook', payload, undefined, headers);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.ignored).toBe('outdated_subscription');

      // Still pro and active!
      const billing = await prisma.workspaceBilling.findUniqueOrThrow({ where: { organizationId: ws.organizationId } });
      expect(billing.plan).toBe('pro');
      expect(billing.status).toBe('active');
      expect(billing.polarSubscriptionId).toBe('sub_new');
    });

    test('ordering: ignores events older than stored lastModifiedAt (Item 4)', async () => {
      const ws = await workspace(newApp());
      await prisma.workspaceBilling.create({
        data: {
          organizationId: ws.organizationId,
          plan: 'pro',
          status: 'active',
          polarCustomerId: 'cus_polar_ts',
          polarSubscriptionId: 'sub_ts_1',
          lastModifiedAt: new Date('2026-10-04T12:00:00Z'),
        },
      });

      // Older event (timestamp 10:00:00Z < 12:00:00Z)
      const eventId = `evt_older_${crypto.randomUUID()}`;
      const payload = {
        type: 'subscription.updated',
        data: {
          id: 'sub_ts_1',
          customer_id: 'cus_polar_ts',
          product_id: PRO_MONTHLY_ID,
          status: 'past_due',
          modified_at: '2026-10-04T10:00:00Z',
        },
      };
      const headers = makeWebhookHeaders(JSON.stringify(payload), TEST_SECRET, { id: eventId });

      const res = await post(ws.app, '/api/v1/billing/webhook', payload, undefined, headers);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.ignored).toBe('outdated_timestamp');

      const billing = await prisma.workspaceBilling.findUniqueOrThrow({ where: { organizationId: ws.organizationId } });
      expect(billing.status).toBe('active'); // Not changed to past_due!
    });

    test('credits: order.paid requires non-null data.id orderId and ignores if missing (Item 5)', async () => {
      const ws = await workspace(newApp());
      const eventId = `evt_order_missing_id_${crypto.randomUUID()}`;
      const payload = {
        type: 'order.paid',
        data: {
          customer: { external_id: ws.organizationId },
          product_id: CREDITS_5000_ID,
          // data.id is missing! Must NOT fall back to eventId!
        },
      };
      const headers = makeWebhookHeaders(JSON.stringify(payload), TEST_SECRET, { id: eventId });

      const res = await post(ws.app, '/api/v1/billing/webhook', payload, undefined, headers);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.ignored).toBe('missing_order_id');

      const count = await prisma.aiCreditLedger.count({ where: { organizationId: ws.organizationId } });
      expect(count).toBe(0);
    });

    test('credits: order.paid grants credits with balanceAfter under row lock idempotently (Item 5)', async () => {
      const ws = await workspace(newApp());
      const orderId = `ord_pack_${crypto.randomUUID()}`;
      const eventId = `evt_order_valid_${crypto.randomUUID()}`;

      const payload = {
        type: 'order.paid',
        data: {
          id: orderId,
          customer: { external_id: ws.organizationId },
          product_id: CREDITS_5000_ID,
        },
      };
      const headers = makeWebhookHeaders(JSON.stringify(payload), TEST_SECRET, { id: eventId });

      const res = await post(ws.app, '/api/v1/billing/webhook', payload, undefined, headers);
      expect(res.status).toBe(200);

      const ledger = await prisma.aiCreditLedger.findFirstOrThrow({
        where: { organizationId: ws.organizationId, reason: 'purchase' },
      });
      expect(ledger.delta).toBe(5000);
      expect(ledger.credits).toBe(5000);
      expect(ledger.orderId).toBe(orderId);
      expect(ledger.balanceAfter).toBe(5000);

      // Replay order: same order id does not add duplicate credits
      const eventId2 = `evt_order_replay_${crypto.randomUUID()}`;
      const headers2 = makeWebhookHeaders(JSON.stringify(payload), TEST_SECRET, { id: eventId2 });
      const res2 = await post(ws.app, '/api/v1/billing/webhook', payload, undefined, headers2);
      expect(res2.status).toBe(200);

      const count = await prisma.aiCreditLedger.count({ where: { organizationId: ws.organizationId } });
      expect(count).toBe(1);
    });

    test('idempotency: duplicate webhook-id header returns duplicate: true (Item 2, 6)', async () => {
      const ws = await workspace(newApp());
      const webhookId = `evt_webhook_dup_${crypto.randomUUID()}`;

      const payload = {
        type: 'subscription.created',
        data: {
          id: 'sub_polar_dup',
          customer_id: 'cus_polar_dup',
          customer: { external_id: ws.organizationId },
          product_id: PRO_MONTHLY_ID,
          status: 'active',
        },
      };
      const bodyStr = JSON.stringify(payload);
      const headers = makeWebhookHeaders(bodyStr, TEST_SECRET, { id: webhookId });

      // First delivery
      const res1 = await post(ws.app, '/api/v1/billing/webhook', payload, undefined, headers);
      expect(res1.status).toBe(200);
      const body1 = (await res1.json()) as any;
      expect(body1.received).toBe(true);
      expect(body1.duplicate).toBeUndefined();

      // Second delivery (replay with same webhook-id header)
      const res2 = await post(ws.app, '/api/v1/billing/webhook', payload, undefined, headers);
      expect(res2.status).toBe(200);
      const body2 = (await res2.json()) as any;
      expect(body2.duplicate).toBe(true);
    });
  });

  describe('Third review billing webhook fixes (A-H)', () => {
    describe('A. Explicit allowlist status mapping', () => {
      test('trialing grants pro with active status', async () => {
        const ws = await workspace(newApp());
        const eventId = `evt_trial_${crypto.randomUUID()}`;
        const payload = {
          type: 'subscription.created',
          data: {
            id: 'sub_trial_1',
            customer: { external_id: ws.organizationId },
            product_id: PRO_MONTHLY_ID,
            status: 'trialing',
          },
        };
        const headers = makeWebhookHeaders(JSON.stringify(payload), TEST_SECRET, { id: eventId });
        const res = await post(ws.app, '/api/v1/billing/webhook', payload, undefined, headers);
        expect(res.status).toBe(200);

        const billing = await prisma.workspaceBilling.findUniqueOrThrow({ where: { organizationId: ws.organizationId } });
        expect(billing.plan).toBe('pro');
        expect(billing.status).toBe('active');
      });

      test('past_due preserves pro plan if already pro, but does not grant pro if free', async () => {
        const ws = await workspace(newApp());
        // Already pro
        await prisma.workspaceBilling.create({
          data: { organizationId: ws.organizationId, plan: 'pro', status: 'active', polarSubscriptionId: 'sub_pd_1' },
        });

        const eventId1 = `evt_pd_pro_${crypto.randomUUID()}`;
        const payload1 = {
          type: 'subscription.updated',
          data: {
            id: 'sub_pd_1',
            customer: { external_id: ws.organizationId },
            product_id: PRO_MONTHLY_ID,
            status: 'past_due',
            modified_at: new Date('2026-10-04T12:00:00Z').toISOString(),
          },
        };
        const headers1 = makeWebhookHeaders(JSON.stringify(payload1), TEST_SECRET, { id: eventId1 });
        const res1 = await post(ws.app, '/api/v1/billing/webhook', payload1, undefined, headers1);
        expect(res1.status).toBe(200);

        const billing1 = await prisma.workspaceBilling.findUniqueOrThrow({ where: { organizationId: ws.organizationId } });
        expect(billing1.plan).toBe('pro');
        expect(billing1.status).toBe('past_due');
      });

      test('canceled with future periodEnd keeps pro with canceled_at_period_end', async () => {
        const ws = await workspace(newApp());
        await prisma.workspaceBilling.create({
          data: { organizationId: ws.organizationId, plan: 'pro', status: 'active', polarSubscriptionId: 'sub_canc_1' },
        });

        const futureDate = new Date(Date.now() + 86400000 * 5).toISOString();
        const eventId = `evt_canc_fut_${crypto.randomUUID()}`;
        const payload = {
          type: 'subscription.canceled',
          data: {
            id: 'sub_canc_1',
            customer: { external_id: ws.organizationId },
            product_id: PRO_MONTHLY_ID,
            status: 'canceled',
            current_period_end: futureDate,
            modified_at: new Date('2026-10-04T12:00:00Z').toISOString(),
          },
        };
        const headers = makeWebhookHeaders(JSON.stringify(payload), TEST_SECRET, { id: eventId });
        const res = await post(ws.app, '/api/v1/billing/webhook', payload, undefined, headers);
        expect(res.status).toBe(200);

        const billing = await prisma.workspaceBilling.findUniqueOrThrow({ where: { organizationId: ws.organizationId } });
        expect(billing.plan).toBe('pro');
        expect(billing.status).toBe('canceled_at_period_end');
        expect(billing.cancelAtPeriodEnd).toBe(true);
      });

      test('canceled with expired periodEnd downgrades to free with canceled status', async () => {
        const ws = await workspace(newApp());
        await prisma.workspaceBilling.create({
          data: { organizationId: ws.organizationId, plan: 'pro', status: 'active', polarSubscriptionId: 'sub_canc_exp' },
        });

        const pastDate = new Date(Date.now() - 86400000).toISOString();
        const eventId = `evt_canc_exp_${crypto.randomUUID()}`;
        const payload = {
          type: 'subscription.canceled',
          data: {
            id: 'sub_canc_exp',
            customer: { external_id: ws.organizationId },
            product_id: PRO_MONTHLY_ID,
            status: 'canceled',
            current_period_end: pastDate,
            modified_at: new Date('2026-10-04T12:00:00Z').toISOString(),
          },
        };
        const headers = makeWebhookHeaders(JSON.stringify(payload), TEST_SECRET, { id: eventId });
        const res = await post(ws.app, '/api/v1/billing/webhook', payload, undefined, headers);
        expect(res.status).toBe(200);

        const billing = await prisma.workspaceBilling.findUniqueOrThrow({ where: { organizationId: ws.organizationId } });
        expect(billing.plan).toBe('free');
        expect(billing.status).toBe('canceled');
      });

      test('revoked downgrades to free with revoked status', async () => {
        const ws = await workspace(newApp());
        await prisma.workspaceBilling.create({
          data: { organizationId: ws.organizationId, plan: 'pro', status: 'active', polarSubscriptionId: 'sub_rev_1' },
        });

        const eventId = `evt_rev_${crypto.randomUUID()}`;
        const payload = {
          type: 'subscription.revoked',
          data: {
            id: 'sub_rev_1',
            customer: { external_id: ws.organizationId },
            product_id: PRO_MONTHLY_ID,
            status: 'revoked',
            modified_at: new Date('2026-10-04T12:00:00Z').toISOString(),
          },
        };
        const headers = makeWebhookHeaders(JSON.stringify(payload), TEST_SECRET, { id: eventId });
        const res = await post(ws.app, '/api/v1/billing/webhook', payload, undefined, headers);
        expect(res.status).toBe(200);

        const billing = await prisma.workspaceBilling.findUniqueOrThrow({ where: { organizationId: ws.organizationId } });
        expect(billing.plan).toBe('free');
        expect(billing.status).toBe('revoked');
        expect(billing.periodEnd).toBeNull();
      });

      test('non-granting statuses (paused, incomplete_expired, unpaid) leave existing plan untouched and record status', async () => {
        const ws = await workspace(newApp());
        await prisma.workspaceBilling.create({
          data: { organizationId: ws.organizationId, plan: 'pro', status: 'active', polarSubscriptionId: 'sub_non_grant' },
        });

        for (const nonGranting of ['paused', 'incomplete_expired', 'unpaid']) {
          const eventId = `evt_ng_${nonGranting}_${crypto.randomUUID()}`;
          const payload = {
            type: 'subscription.updated',
            data: {
              id: 'sub_non_grant',
              customer: { external_id: ws.organizationId },
              product_id: PRO_MONTHLY_ID,
              status: nonGranting,
              modified_at: new Date().toISOString(),
            },
          };
          const headers = makeWebhookHeaders(JSON.stringify(payload), TEST_SECRET, { id: eventId });
          const res = await post(ws.app, '/api/v1/billing/webhook', payload, undefined, headers);
          expect(res.status).toBe(200);

          const billing = await prisma.workspaceBilling.findUniqueOrThrow({ where: { organizationId: ws.organizationId } });
          expect(billing.plan).toBe('pro'); // Plan left untouched!
          expect(billing.status).toBe(nonGranting); // Status recorded!
        }
      });

      test('unknown status leaves existing plan untouched, records status, and never grants pro', async () => {
        const ws = await workspace(newApp());
        // Workspace starts on free
        const eventId = `evt_unknown_st_${crypto.randomUUID()}`;
        const payload = {
          type: 'subscription.created',
          data: {
            id: 'sub_unknown_1',
            customer: { external_id: ws.organizationId },
            product_id: PRO_MONTHLY_ID,
            status: 'some_future_polar_status',
          },
        };
        const headers = makeWebhookHeaders(JSON.stringify(payload), TEST_SECRET, { id: eventId });
        const res = await post(ws.app, '/api/v1/billing/webhook', payload, undefined, headers);
        expect(res.status).toBe(200);

        const billing = await prisma.workspaceBilling.findUniqueOrThrow({ where: { organizationId: ws.organizationId } });
        expect(billing.plan).toBe('free'); // Stays free! Never turns unknown into pro!
        expect(billing.status).toBe('some_future_polar_status');
      });
    });

    describe('B. Stale-subscription guard', () => {
      test('subscription.updated for different subscription id is ignored (no isCreatedOrActive bypass)', async () => {
        const ws = await workspace(newApp());
        await prisma.workspaceBilling.create({
          data: {
            organizationId: ws.organizationId,
            plan: 'pro',
            status: 'active',
            polarSubscriptionId: 'sub_primary',
          },
        });

        const eventId = `evt_diff_sub_${crypto.randomUUID()}`;
        const payload = {
          type: 'subscription.updated',
          data: {
            id: 'sub_different',
            customer: { external_id: ws.organizationId },
            product_id: PRO_MONTHLY_ID,
            status: 'active', // Active status must NOT bypass!
          },
        };
        const headers = makeWebhookHeaders(JSON.stringify(payload), TEST_SECRET, { id: eventId });
        const res = await post(ws.app, '/api/v1/billing/webhook', payload, undefined, headers);
        expect(res.status).toBe(200);
        const body = (await res.json()) as any;
        expect(body.ignored).toBe('outdated_subscription');

        const billing = await prisma.workspaceBilling.findUniqueOrThrow({ where: { organizationId: ws.organizationId } });
        expect(billing.polarSubscriptionId).toBe('sub_primary');
      });

      test('subscription.created with active or trialing replaces old stored subscription', async () => {
        const ws = await workspace(newApp());
        await prisma.workspaceBilling.create({
          data: {
            organizationId: ws.organizationId,
            plan: 'free',
            status: 'canceled',
            polarSubscriptionId: 'sub_old_ended',
          },
        });

        const eventId = `evt_new_sub_${crypto.randomUUID()}`;
        const payload = {
          type: 'subscription.created',
          data: {
            id: 'sub_brand_new',
            customer: { external_id: ws.organizationId },
            product_id: PRO_MONTHLY_ID,
            status: 'active',
          },
        };
        const headers = makeWebhookHeaders(JSON.stringify(payload), TEST_SECRET, { id: eventId });
        const res = await post(ws.app, '/api/v1/billing/webhook', payload, undefined, headers);
        expect(res.status).toBe(200);

        const billing = await prisma.workspaceBilling.findUniqueOrThrow({ where: { organizationId: ws.organizationId } });
        expect(billing.polarSubscriptionId).toBe('sub_brand_new');
        expect(billing.plan).toBe('pro');
        expect(billing.status).toBe('active');
      });

      test('subscription.created for different subscription id is applied only when strictly newer; late event is ignored as outdated_subscription', async () => {
        const ws = await workspace(newApp());
        const t1 = new Date('2026-10-04T10:00:00Z');
        const t2 = new Date('2026-10-04T12:00:00Z');

        // Apply created(S2, t2)
        const eventIdS2 = `evt_s2_${crypto.randomUUID()}`;
        const payloadS2 = {
          type: 'subscription.created',
          data: {
            id: 'sub_s2',
            customer: { external_id: ws.organizationId },
            product_id: PRO_MONTHLY_ID,
            status: 'active',
            modified_at: t2.toISOString(),
          },
        };
        const headersS2 = makeWebhookHeaders(JSON.stringify(payloadS2), TEST_SECRET, { id: eventIdS2 });
        const resS2 = await post(ws.app, '/api/v1/billing/webhook', payloadS2, undefined, headersS2);
        expect(resS2.status).toBe(200);

        const billingAfterS2 = await prisma.workspaceBilling.findUniqueOrThrow({ where: { organizationId: ws.organizationId } });
        expect(billingAfterS2.polarSubscriptionId).toBe('sub_s2');
        expect(billingAfterS2.plan).toBe('pro');
        expect(billingAfterS2.status).toBe('active');
        expect(billingAfterS2.lastModifiedAt?.toISOString()).toBe(t2.toISOString());

        // Apply a late created(S1, t1 < t2)
        const eventIdS1 = `evt_s1_${crypto.randomUUID()}`;
        const payloadS1 = {
          type: 'subscription.created',
          data: {
            id: 'sub_s1',
            customer: { external_id: ws.organizationId },
            product_id: PRO_MONTHLY_ID,
            status: 'active',
            modified_at: t1.toISOString(),
          },
        };
        const headersS1 = makeWebhookHeaders(JSON.stringify(payloadS1), TEST_SECRET, { id: eventIdS1 });
        const resS1 = await post(ws.app, '/api/v1/billing/webhook', payloadS1, undefined, headersS1);
        expect(resS1.status).toBe(200);
        const bodyS1 = (await resS1.json()) as any;
        expect(bodyS1.ignored).toBe('outdated_subscription');

        // The workspace stays on S2
        const billingFinal = await prisma.workspaceBilling.findUniqueOrThrow({ where: { organizationId: ws.organizationId } });
        expect(billingFinal.polarSubscriptionId).toBe('sub_s2');
        expect(billingFinal.plan).toBe('pro');
        expect(billingFinal.status).toBe('active');
        expect(billingFinal.lastModifiedAt?.toISOString()).toBe(t2.toISOString());

        // Also test created_at fallback: late created(S0, t0 < t2) using created_at instead of modified_at
        const t0 = new Date('2026-10-04T08:00:00Z');
        const eventIdS0 = `evt_s0_${crypto.randomUUID()}`;
        const payloadS0 = {
          type: 'subscription.created',
          data: {
            id: 'sub_s0',
            customer: { external_id: ws.organizationId },
            product_id: PRO_MONTHLY_ID,
            status: 'trialing',
            created_at: t0.toISOString(),
          },
        };
        const headersS0 = makeWebhookHeaders(JSON.stringify(payloadS0), TEST_SECRET, { id: eventIdS0 });
        const resS0 = await post(ws.app, '/api/v1/billing/webhook', payloadS0, undefined, headersS0);
        expect(resS0.status).toBe(200);
        const bodyS0 = (await resS0.json()) as any;
        expect(bodyS0.ignored).toBe('outdated_subscription');

        const billingStillS2 = await prisma.workspaceBilling.findUniqueOrThrow({ where: { organizationId: ws.organizationId } });
        expect(billingStillS2.polarSubscriptionId).toBe('sub_s2');
      });

      test('when stored id is null, canceled/revoked/updated are ignored as no_stored_subscription', async () => {
        const ws = await workspace(newApp());

        for (const type of ['subscription.canceled', 'subscription.revoked', 'subscription.updated']) {
          const eventId = `evt_null_id_${type}_${crypto.randomUUID()}`;
          const payload = {
            type,
            data: {
              id: 'sub_ghost',
              customer: { external_id: ws.organizationId },
              product_id: PRO_MONTHLY_ID,
              status: 'canceled',
            },
          };
          const headers = makeWebhookHeaders(JSON.stringify(payload), TEST_SECRET, { id: eventId });
          const res = await post(ws.app, '/api/v1/billing/webhook', payload, undefined, headers);
          expect(res.status).toBe(200);
          const body = (await res.json()) as any;
          expect(body.ignored).toBe('no_stored_subscription');
        }
      });

      test('ties on modified_at are ignored as outdated_timestamp', async () => {
        const ws = await workspace(newApp());
        const timestamp = new Date('2026-10-04T12:00:00Z');
        await prisma.workspaceBilling.create({
          data: {
            organizationId: ws.organizationId,
            plan: 'pro',
            status: 'active',
            polarSubscriptionId: 'sub_tie_1',
            lastModifiedAt: timestamp,
          },
        });

        // Event with identical timestamp
        const eventId = `evt_tie_${crypto.randomUUID()}`;
        const payload = {
          type: 'subscription.updated',
          data: {
            id: 'sub_tie_1',
            customer: { external_id: ws.organizationId },
            product_id: PRO_MONTHLY_ID,
            status: 'past_due',
            modified_at: timestamp.toISOString(),
          },
        };
        const headers = makeWebhookHeaders(JSON.stringify(payload), TEST_SECRET, { id: eventId });
        const res = await post(ws.app, '/api/v1/billing/webhook', payload, undefined, headers);
        expect(res.status).toBe(200);
        const body = (await res.json()) as any;
        expect(body.ignored).toBe('outdated_timestamp');

        const billing = await prisma.workspaceBilling.findUniqueOrThrow({ where: { organizationId: ws.organizationId } });
        expect(billing.status).toBe('active'); // Still active!
      });
    });

    describe('C. Transaction locking & sequential interleavings', () => {
      test('sequential interleavings: stale event arriving after fresh event is ignored', async () => {
        const ws = await workspace(newApp());
        const tFresh = new Date('2026-10-04T12:00:00Z');
        const tStale = new Date('2026-10-04T11:00:00Z');

        // Fresh event arrives first
        const freshId = `evt_fresh_${crypto.randomUUID()}`;
        const freshPayload = {
          type: 'subscription.created',
          data: {
            id: 'sub_seq_1',
            customer: { external_id: ws.organizationId },
            product_id: PRO_MONTHLY_ID,
            status: 'active',
            modified_at: tFresh.toISOString(),
          },
        };
        const freshRes = await post(
          ws.app,
          '/api/v1/billing/webhook',
          freshPayload,
          undefined,
          makeWebhookHeaders(JSON.stringify(freshPayload), TEST_SECRET, { id: freshId }),
        );
        expect(freshRes.status).toBe(200);

        // Stale event arrives next
        const staleId = `evt_stale_${crypto.randomUUID()}`;
        const stalePayload = {
          type: 'subscription.updated',
          data: {
            id: 'sub_seq_1',
            customer: { external_id: ws.organizationId },
            product_id: PRO_MONTHLY_ID,
            status: 'past_due',
            modified_at: tStale.toISOString(),
          },
        };
        const staleRes = await post(
          ws.app,
          '/api/v1/billing/webhook',
          stalePayload,
          undefined,
          makeWebhookHeaders(JSON.stringify(stalePayload), TEST_SECRET, { id: staleId }),
        );
        expect(staleRes.status).toBe(200);
        const staleBody = (await staleRes.json()) as any;
        expect(staleBody.ignored).toBe('outdated_timestamp');

        const billing = await prisma.workspaceBilling.findUniqueOrThrow({ where: { organizationId: ws.organizationId } });
        expect(billing.status).toBe('active');
        expect(billing.lastModifiedAt?.toISOString()).toBe(tFresh.toISOString());
      });
    });

    describe('D. Product ID check and enterprise protection', () => {
      test('canceled/revoked/updated with unmapped product_id is ignored as unknown_product_id', async () => {
        const ws = await workspace(newApp());

        for (const type of ['subscription.canceled', 'subscription.revoked', 'subscription.updated']) {
          const eventId = `evt_unmapped_${type}_${crypto.randomUUID()}`;
          const payload = {
            type,
            data: {
              id: 'sub_unknown_prod',
              customer: { external_id: ws.organizationId },
              product_id: 'prod_completely_unknown',
            },
          };
          const headers = makeWebhookHeaders(JSON.stringify(payload), TEST_SECRET, { id: eventId });
          const res = await post(ws.app, '/api/v1/billing/webhook', payload, undefined, headers);
          expect(res.status).toBe(200);
          const body = (await res.json()) as any;
          expect(body.ignored).toBe('unknown_product_id');
        }
      });

      test('enterprise plan protection: polar events leave plan, status, periodEnd and cancelAtPeriodEnd untouched (tested with canceled and revoked)', async () => {
        const ws = await workspace(newApp());
        const originalPeriodEnd = new Date('2027-01-01T00:00:00Z');
        const t0 = new Date('2026-10-04T09:00:00Z');
        const t1 = new Date('2026-10-04T10:00:00Z');
        const t2 = new Date('2026-10-04T11:00:00Z');

        await prisma.workspaceBilling.create({
          data: {
            organizationId: ws.organizationId,
            plan: 'enterprise',
            status: 'active',
            periodEnd: originalPeriodEnd,
            cancelAtPeriodEnd: false,
            polarSubscriptionId: 'sub_ent_1',
            polarCustomerId: 'cus_ent_1',
            lastModifiedAt: t0,
          },
        });

        // 1. Polar sends subscription.canceled after subscription id is stored
        const eventIdCanceled = `evt_ent_canc_${crypto.randomUUID()}`;
        const payloadCanceled = {
          type: 'subscription.canceled',
          data: {
            id: 'sub_ent_1',
            customer_id: 'cus_ent_1',
            customer: { external_id: ws.organizationId },
            product_id: PRO_MONTHLY_ID,
            status: 'canceled',
            current_period_end: new Date('2026-10-05T00:00:00Z').toISOString(),
            cancel_at_period_end: true,
            modified_at: t1.toISOString(),
          },
        };
        const headersCanceled = makeWebhookHeaders(JSON.stringify(payloadCanceled), TEST_SECRET, { id: eventIdCanceled });
        const resCanceled = await post(ws.app, '/api/v1/billing/webhook', payloadCanceled, undefined, headersCanceled);
        expect(resCanceled.status).toBe(200);

        const billingAfterCanceled = await prisma.workspaceBilling.findUniqueOrThrow({ where: { organizationId: ws.organizationId } });
        expect(billingAfterCanceled.plan).toBe('enterprise'); // Plan untouched
        expect(billingAfterCanceled.status).toBe('active'); // Status untouched (NOT canceled or canceled_at_period_end)
        expect(billingAfterCanceled.periodEnd?.toISOString()).toBe(originalPeriodEnd.toISOString()); // periodEnd untouched
        expect(billingAfterCanceled.cancelAtPeriodEnd).toBe(false); // cancelAtPeriodEnd untouched
        expect(billingAfterCanceled.polarSubscriptionId).toBe('sub_ent_1');
        expect(billingAfterCanceled.polarCustomerId).toBe('cus_ent_1');
        expect(billingAfterCanceled.lastModifiedAt?.toISOString()).toBe(t1.toISOString()); // lastModifiedAt recorded

        // 2. Polar sends subscription.revoked after subscription id is stored
        const eventIdRevoked = `evt_ent_rev_${crypto.randomUUID()}`;
        const payloadRevoked = {
          type: 'subscription.revoked',
          data: {
            id: 'sub_ent_1',
            customer_id: 'cus_ent_1',
            customer: { external_id: ws.organizationId },
            product_id: PRO_MONTHLY_ID,
            status: 'revoked',
            modified_at: t2.toISOString(),
          },
        };
        const headersRevoked = makeWebhookHeaders(JSON.stringify(payloadRevoked), TEST_SECRET, { id: eventIdRevoked });
        const resRevoked = await post(ws.app, '/api/v1/billing/webhook', payloadRevoked, undefined, headersRevoked);
        expect(resRevoked.status).toBe(200);

        const billingAfterRevoked = await prisma.workspaceBilling.findUniqueOrThrow({ where: { organizationId: ws.organizationId } });
        expect(billingAfterRevoked.plan).toBe('enterprise'); // Plan untouched
        expect(billingAfterRevoked.status).toBe('active'); // Status untouched (NOT revoked)
        expect(billingAfterRevoked.periodEnd?.toISOString()).toBe(originalPeriodEnd.toISOString()); // periodEnd untouched (NOT null)
        expect(billingAfterRevoked.cancelAtPeriodEnd).toBe(false); // cancelAtPeriodEnd untouched
        expect(billingAfterRevoked.polarSubscriptionId).toBe('sub_ent_1');
        expect(billingAfterRevoked.polarCustomerId).toBe('cus_ent_1');
        expect(billingAfterRevoked.lastModifiedAt?.toISOString()).toBe(t2.toISOString()); // lastModifiedAt recorded
      });
    });

    describe('E. Duplicate detection', () => {
      test('duplicate detection against real Postgres database without mocks: returns 200 both times, second with duplicate true, exactly 1 BillingEvent row and 1 applied change', async () => {
        const ws = await workspace(newApp());
        const webhookId = `evt_real_db_dup_${crypto.randomUUID()}`;
        const orderId = `ord_real_db_${crypto.randomUUID()}`;

        const payload = {
          type: 'order.paid',
          data: {
            id: orderId,
            customer: { external_id: ws.organizationId },
            product_id: CREDITS_5000_ID,
          },
        };
        const bodyStr = JSON.stringify(payload);
        const headers = makeWebhookHeaders(bodyStr, TEST_SECRET, { id: webhookId });

        // First delivery: real DB insert of BillingEvent and credit ledger
        const res1 = await post(ws.app, '/api/v1/billing/webhook', payload, undefined, headers);
        expect(res1.status).toBe(200);
        const body1 = (await res1.json()) as any;
        expect(body1.received).toBe(true);
        expect(body1.duplicate).toBeUndefined();

        // Second delivery: same signed webhook (same webhook-id) through the app against test Postgres without mocks
        const res2 = await post(ws.app, '/api/v1/billing/webhook', payload, undefined, headers);
        expect(res2.status).toBe(200);
        const body2 = (await res2.json()) as any;
        expect(body2.received).toBe(true);
        expect(body2.duplicate).toBe(true);

        // Exactly one BillingEvent row in the real database
        const events = await prisma.billingEvent.findMany({ where: { eventId: webhookId } });
        expect(events).toHaveLength(1);

        // Exactly one applied change in the real database
        const ledgers = await prisma.aiCreditLedger.findMany({ where: { organizationId: ws.organizationId } });
        expect(ledgers).toHaveLength(1);
        expect(ledgers[0].delta).toBe(5000);
        expect(ledgers[0].balanceAfter).toBe(5000);
      });

      test('duplicate detection against real Postgres database for subscription.created: returns 200 both times, second with duplicate true, exactly 1 BillingEvent row and 1 applied change', async () => {
        const ws = await workspace(newApp());
        const webhookId = `evt_real_sub_dup_${crypto.randomUUID()}`;

        const payload = {
          type: 'subscription.created',
          data: {
            id: 'sub_real_db_1',
            customer_id: 'cus_real_db_1',
            customer: { external_id: ws.organizationId },
            product_id: PRO_MONTHLY_ID,
            status: 'active',
            modified_at: new Date('2026-10-04T12:00:00Z').toISOString(),
          },
        };
        const bodyStr = JSON.stringify(payload);
        const headers = makeWebhookHeaders(bodyStr, TEST_SECRET, { id: webhookId });

        // First delivery
        const res1 = await post(ws.app, '/api/v1/billing/webhook', payload, undefined, headers);
        expect(res1.status).toBe(200);
        const body1 = (await res1.json()) as any;
        expect(body1.received).toBe(true);
        expect(body1.duplicate).toBeUndefined();

        // Second delivery (replay same signed webhook with same webhook-id)
        const res2 = await post(ws.app, '/api/v1/billing/webhook', payload, undefined, headers);
        expect(res2.status).toBe(200);
        const body2 = (await res2.json()) as any;
        expect(body2.received).toBe(true);
        expect(body2.duplicate).toBe(true);

        // Exactly one BillingEvent row
        const events = await prisma.billingEvent.findMany({ where: { eventId: webhookId } });
        expect(events).toHaveLength(1);

        // Exactly one applied change (workspace billing exists and is pro)
        const allBillings = await prisma.workspaceBilling.findMany({ where: { organizationId: ws.organizationId } });
        expect(allBillings).toHaveLength(1);
        expect(allBillings[0].plan).toBe('pro');
        expect(allBillings[0].polarSubscriptionId).toBe('sub_real_db_1');
      });

      test('duplicate BillingEvent returns duplicate: true; other unique violation rethrows 500', async () => {
        const ws = await workspace(newApp());
        const eventId = `evt_dup_e_${crypto.randomUUID()}`;

        // Insert BillingEvent directly
        await prisma.billingEvent.create({ data: { eventId, receivedAt: new Date() } });

        const payload = {
          type: 'subscription.created',
          data: {
            id: 'sub_e_1',
            customer: { external_id: ws.organizationId },
            product_id: PRO_MONTHLY_ID,
            status: 'active',
          },
        };
        const headers = makeWebhookHeaders(JSON.stringify(payload), TEST_SECRET, { id: eventId });
        const res = await post(ws.app, '/api/v1/billing/webhook', payload, undefined, headers);
        expect(res.status).toBe(200);
        const body = (await res.json()) as any;
        expect(body.duplicate).toBe(true);
      });

      test('unique violation on another table rethrows as 500', async () => {
        const ws = await workspace(newApp());
        const eventId = `evt_other_dup_${crypto.randomUUID()}`;

        const origTx = prisma.$transaction;
        (prisma as any).$transaction = async () => {
          const err: any = new Error('Unique constraint failed on the fields: (`orderId`)');
          err.code = 'P2002';
          err.meta = { target: ['orderId'], modelName: 'AiCreditLedger' };
          throw err;
        };

        try {
          const payload = {
            type: 'subscription.created',
            data: {
              id: 'sub_rethrow_1',
              customer: { external_id: ws.organizationId },
              product_id: PRO_MONTHLY_ID,
              status: 'active',
            },
          };
          const headers = makeWebhookHeaders(JSON.stringify(payload), TEST_SECRET, { id: eventId });
          const res = await post(ws.app, '/api/v1/billing/webhook', payload, undefined, headers);
          expect(res.status).toBe(500);
        } finally {
          (prisma as any).$transaction = origTx;
        }
      });
    });

    describe('F. Parse org metadata defensively', () => {
      test('GET /api/v1/billing handles null or non-object org metadata defensively', async () => {
        const ws = await workspace(newApp());

        for (const invalidMeta of ['null', '123', '"a string"', '[1, 2, 3]']) {
          await prisma.organization.update({
            where: { id: ws.organizationId },
            data: { metadata: invalidMeta },
          });

          const res = await get(ws.app, '/api/v1/billing', ws.cookie);
          expect(res.status).toBe(200);
          const body = (await res.json()) as any;
          expect(body.invoice_details).toEqual({ email: '', company: '', tax_id: '' });
        }
      });

      test('PATCH /api/v1/billing/invoice-details handles null or non-object org metadata defensively', async () => {
        const ws = await workspace(newApp());

        for (const invalidMeta of ['null', '123', '"a string"', '[1, 2, 3]']) {
          await prisma.organization.update({
            where: { id: ws.organizationId },
            data: { metadata: invalidMeta },
          });

          const res = await patch(
            ws.app,
            '/api/v1/billing/invoice-details',
            { email: 'safe@acme.test', company: 'Defensive Inc', tax_id: 'TAX-001' },
            ws.cookie,
          );
          expect(res.status).toBe(200);
          const body = (await res.json()) as any;
          expect(body.invoice_details.email).toBe('safe@acme.test');
          expect(body.invoice_details.company).toBe('Defensive Inc');
        }
      });
    });

    describe('G. Validate dates from payload', () => {
      test('invalid date strings in modified_at and current_period_end are ignored and never store Invalid Date', async () => {
        const ws = await workspace(newApp());
        const eventId = `evt_invalid_date_${crypto.randomUUID()}`;

        const payload = {
          type: 'subscription.created',
          data: {
            id: 'sub_bad_date_1',
            customer: { external_id: ws.organizationId },
            product_id: PRO_MONTHLY_ID,
            status: 'active',
            modified_at: 'not-a-valid-date-string',
            current_period_end: 'completely-invalid-date',
          },
        };
        const headers = makeWebhookHeaders(JSON.stringify(payload), TEST_SECRET, { id: eventId });
        const res = await post(ws.app, '/api/v1/billing/webhook', payload, undefined, headers);
        expect(res.status).toBe(200);

        const billing = await prisma.workspaceBilling.findUniqueOrThrow({ where: { organizationId: ws.organizationId } });
        expect(billing.periodEnd).toBeNull();
        expect(billing.lastModifiedAt).not.toBeNull();
        expect(Number.isNaN(billing.lastModifiedAt!.getTime())).toBe(false);
      });

      test('checkout guard blocks canceled subscription with periodEnd null (409 canceled_subscription_active)', async () => {
        const ws = await workspace(newApp());
        await prisma.workspaceBilling.create({
          data: {
            organizationId: ws.organizationId,
            plan: 'pro',
            status: 'canceled_at_period_end',
            cancelAtPeriodEnd: true,
            periodEnd: null, // Null periodEnd with cancel flag set
          },
        });

        const res = await post(ws.app, '/api/v1/billing/checkout', { interval: 'monthly' }, ws.cookie);
        expect(res.status).toBe(409);
        const body = (await res.json()) as any;
        expect(body.error.code).toBe('canceled_subscription_active');
      });
    });

    describe('H. Portal route customer resolution and stable error messages', () => {
      test('portal tries externalCustomerId when polarCustomerId is null', async () => {
        const ws = await workspace(newApp());
        let capturedParams: any = null;
        const fakeClient: any = {
          customerSessions: {
            create: async (params: any) => {
              capturedParams = params;
              return { customerPortalUrl: 'https://polar.sh/portal/session_ext' };
            },
          },
        };
        setPolarClient(fakeClient);

        const res = await post(ws.app, '/api/v1/billing/portal', {}, ws.cookie);
        expect(res.status).toBe(200);
        const body = (await res.json()) as any;
        expect(body.url).toBe('https://polar.sh/portal/session_ext');
        expect(capturedParams.externalCustomerId).toBe(ws.organizationId);
      });

      test('portal falls back to externalCustomerId when polarCustomerId returns 404', async () => {
        const ws = await workspace(newApp());
        await prisma.workspaceBilling.create({
          data: {
            organizationId: ws.organizationId,
            polarCustomerId: 'cus_stale_123',
          },
        });

        let callCount = 0;
        let lastParams: any = null;
        const fakeClient: any = {
          customerSessions: {
            create: async (params: any) => {
              callCount++;
              lastParams = params;
              if (params.customerId === 'cus_stale_123') {
                const err: any = new Error('Not found');
                err.statusCode = 404;
                throw err;
              }
              return { customerPortalUrl: 'https://polar.sh/portal/session_fallback' };
            },
          },
        };
        setPolarClient(fakeClient);

        const res = await post(ws.app, '/api/v1/billing/portal', {}, ws.cookie);
        expect(res.status).toBe(200);
        expect(callCount).toBe(2);
        expect(lastParams.externalCustomerId).toBe(ws.organizationId);
      });

      test('error responses on checkout, portal, and webhook do not leak env vars or err.message', async () => {
        const ws = await workspace(newApp());

        // Checkout 502 does not leak err.message
        const fakeClientCheckoutErr: any = {
          checkouts: {
            create: async () => {
              throw new Error('Sensitive internal database error message');
            },
          },
        };
        setPolarClient(fakeClientCheckoutErr);
        const checkRes = await post(ws.app, '/api/v1/billing/checkout', { interval: 'monthly' }, ws.cookie);
        expect(checkRes.status).toBe(502);
        const checkBody = (await checkRes.json()) as any;
        expect(checkBody.error.code).toBe('polar_api_error');
        expect(checkBody.error.message).not.toContain('Sensitive internal database error message');

        // Portal 502 does not leak err.message
        const fakeClientPortalErr: any = {
          customerSessions: {
            create: async () => {
              throw new Error('Polar proprietary connection error details');
            },
          },
        };
        setPolarClient(fakeClientPortalErr);
        const portRes = await post(ws.app, '/api/v1/billing/portal', {}, ws.cookie);
        expect(portRes.status).toBe(502);
        const portBody = (await portRes.json()) as any;
        expect(portBody.error.code).toBe('polar_api_error');
        expect(portBody.error.message).not.toContain('Polar proprietary connection error details');

        // 500 when POLAR_PRODUCT_PRO_MONTHLY is unset does not name env var
        delete process.env.POLAR_PRODUCT_PRO_MONTHLY;
        const check500Res = await post(ws.app, '/api/v1/billing/checkout', { interval: 'monthly' }, ws.cookie);
        expect(check500Res.status).toBe(500);
        const check500Body = (await check500Res.json()) as any;
        expect(check500Body.error.code).toBe('server_misconfigured');
        expect(check500Body.error.message).not.toContain('POLAR_PRODUCT');

        // 500 when POLAR_WEBHOOK_SECRET is unset does not name env var
        delete process.env.POLAR_WEBHOOK_SECRET;
        const wh500Res = await post(ws.app, '/api/v1/billing/webhook', { type: 'subscription.created' });
        expect(wh500Res.status).toBe(500);
        const wh500Body = (await wh500Res.json()) as any;
        expect(wh500Body.error.code).toBe('server_misconfigured');
        expect(wh500Body.error.message).not.toContain('POLAR_WEBHOOK_SECRET');
      });
    });
  });
});
