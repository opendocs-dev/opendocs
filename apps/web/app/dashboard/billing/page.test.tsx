import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

mock.module('next/headers', () => ({
  headers: async () => ({ get: () => null }),
}));

// Dynamic import so next/headers is mocked before `./page` (and its
// transitive server-api import) resolve the real module.
const BillingPage = (await import('./page')).default;

const realFetch = globalThis.fetch;
const originalBillingReady = process.env.BILLING_READY;
let responses: Record<string, unknown> = {};

function stubFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [match, body] of Object.entries(responses)) {
      if (url.includes(match)) {
        return new Response(JSON.stringify(body), { status: 200 });
      }
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  process.env.BILLING_READY = 'true';
});

afterEach(() => {
  globalThis.fetch = realFetch;
  responses = {};
  if (originalBillingReady !== undefined) {
    process.env.BILLING_READY = originalBillingReady;
  } else {
    delete process.env.BILLING_READY;
  }
});

describe('BillingPage (UI-A18)', () => {
  test('returns 404 (calls notFound) when BILLING_READY is off', async () => {
    process.env.BILLING_READY = 'false';
    expect(BillingPage()).rejects.toThrow();
  });

  test('owner gets full billing page with all 5 cards and details', async () => {
    responses = {
      '/api/v1/me': {
        workspace: { id: 'org1', name: 'Acme Corp' },
        plan: 'enterprise',
        quota: { files_left: 10, bytes_left: 1000 },
        min_cli_version: '1.0.0',
        role: 'owner',
      },
      '/api/v1/billing': {
        subscription: {
          plan: 'enterprise',
          status: 'active',
          billing_cycle: 'monthly',
          next_invoice_date: 'Oct 1, 2026',
          period_end: '2026-10-01T00:00:00Z',
          cancel_at_period_end: false,
        },
        payment_method: {
          brand: 'Visa',
          last4: '4242',
          exp_month: 8,
          exp_year: 2028,
        },
        invoice_details: {
          email: 'billing@example.com',
          company: 'Acme Corp',
          tax_id: 'US123456789',
        },
        invoices: [
          {
            id: 'ord_123',
            date: 'Oct 1, 2026',
            number: 'ord_123',
            amount: '$29.00',
            status: 'paid',
            pdf_url: 'https://polar.sh/invoices/ord_123.pdf',
          },
        ],
        portal_url: 'https://polar.sh',
        ai_credits: {
          balance: 10000,
          packs: [
            { credits: 1000, price: 'Price to be set' },
            { credits: 5000, price: 'Price to be set' },
            { credits: 20000, price: 'Price to be set' },
          ],
        },
      },
    };
    stubFetch();

    const element = await BillingPage();
    const html = renderToStaticMarkup(element);

    // Header checks
    expect(html).toContain('Billing');
    expect(html).toContain('Only owners can see this page');
    expect(html).toContain('Payment is handled by our payment provider, so card details are never entered here.');
    expect(html).toContain('Open payment portal');

    // Card 1: Subscription
    expect(html).toContain('Subscription');
    expect(html).toContain('Enterprise');
    expect(html).toContain('Active');
    expect(html).toContain('Billed monthly. Next invoice on Oct 1, 2026.');
    expect(html).toContain('Change plan');
    expect(html).toContain('Cancel subscription');

    // Card 2: Payment method
    expect(html).toContain('Payment method');
    expect(html).toContain('Visa ending 4242');
    expect(html).toContain('Expires 08/2028');
    expect(html).toContain('Update in payment portal');

    // Card 3: Invoice details
    expect(html).toContain('Invoice details');
    expect(html).toContain('Send invoices to');
    expect(html).toContain('Company name');
    expect(html).toContain('Tax ID');
    expect(html).toContain('Save');

    // Card 4: Add AI credits
    expect(html).toContain('Add AI credits');
    expect(html).toContain('Extra credits are added to this month and expire with it. 1 credit = 1 reply.');
    expect(html).toContain('1,000 credits');
    expect(html).toContain('5,000 credits');
    expect(html).toContain('20,000 credits');
    expect(html).toContain('Price to be set');
    expect(html).toContain('Buy credits');

    // Card 5: Invoices (no sample data label)
    expect(html).toContain('Invoices');
    expect(html).not.toContain('Invoices (sample data)');
    expect(html).toContain('ord_123');
    expect(html).toContain('$29.00');
    expect(html).toContain('Paid');
    expect(html).toContain('Download PDF');
  });

  test('admin role sees access denied alert and no billing details', async () => {
    responses = {
      '/api/v1/me': {
        workspace: { id: 'org1', name: 'Acme Corp' },
        plan: 'enterprise',
        quota: {},
        min_cli_version: '1.0.0',
        role: 'admin',
      },
      '/api/v1/billing': null,
    };
    stubFetch();

    const element = await BillingPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Only owners can see this page');
    expect(html).toContain('Only workspace owners can view or manage billing.');
    expect(html).not.toContain('Open payment portal');
    expect(html).not.toContain('Invoices');
  });

  test('editor role sees access denied alert', async () => {
    responses = {
      '/api/v1/me': {
        workspace: { id: 'org1', name: 'Acme Corp' },
        plan: 'free',
        quota: {},
        min_cli_version: '1.0.0',
        role: 'editor',
      },
      '/api/v1/billing': null,
    };
    stubFetch();

    const element = await BillingPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Only owners can see this page');
    expect(html).toContain('Only workspace owners can view or manage billing.');
  });

  test('Free plan shows empty states for payment method and invoices', async () => {
    responses = {
      '/api/v1/me': {
        workspace: { id: 'org1', name: 'Acme Corp' },
        plan: 'free',
        quota: {},
        min_cli_version: '1.0.0',
        role: 'owner',
      },
      '/api/v1/billing': {
        subscription: {
          plan: 'free',
          status: 'free',
          billing_cycle: 'monthly',
          next_invoice_date: null,
          period_end: null,
          cancel_at_period_end: false,
        },
        payment_method: null,
        invoice_details: { email: '', company: '', tax_id: '' },
        invoices: [],
        portal_url: 'https://polar.sh',
        ai_credits: {
          balance: 0,
          packs: [
            { credits: 1000, price: 'Price to be set' },
            { credits: 5000, price: 'Price to be set' },
            { credits: 20000, price: 'Price to be set' },
          ],
        },
      },
    };
    stubFetch();

    const element = await BillingPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Free');
    expect(html).toContain('You are on the Free plan.');
    expect(html).toContain('No payment method on file.');
    expect(html).toContain('No invoices yet.');
  });

  test('past_due status renders warning alert', async () => {
    responses = {
      '/api/v1/me': {
        workspace: { id: 'org1', name: 'Acme Corp' },
        plan: 'pro',
        quota: {},
        min_cli_version: '1.0.0',
        role: 'owner',
      },
      '/api/v1/billing': {
        subscription: {
          plan: 'pro',
          status: 'past_due',
          billing_cycle: 'monthly',
          next_invoice_date: 'Oct 1, 2026',
          period_end: '2026-10-01T00:00:00Z',
          cancel_at_period_end: false,
        },
        payment_method: { brand: 'Visa', last4: '4242', exp_month: 8, exp_year: 2028 },
        invoice_details: { email: '', company: '', tax_id: '' },
        invoices: [],
        portal_url: 'https://polar.sh',
        ai_credits: { balance: 1000, packs: [] },
      },
    };
    stubFetch();

    const element = await BillingPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Past due');
    expect(html).toContain('Payment is past due.');
  });

  test('canceled_at_period_end status renders warning badge and message', async () => {
    responses = {
      '/api/v1/me': {
        workspace: { id: 'org1', name: 'Acme Corp' },
        plan: 'enterprise',
        quota: {},
        min_cli_version: '1.0.0',
        role: 'owner',
      },
      '/api/v1/billing': {
        subscription: {
          plan: 'enterprise',
          status: 'canceled_at_period_end',
          billing_cycle: 'monthly',
          next_invoice_date: 'Oct 1, 2026',
          period_end: '2026-10-01T00:00:00Z',
          cancel_at_period_end: true,
        },
        payment_method: { brand: 'Visa', last4: '4242', exp_month: 8, exp_year: 2028 },
        invoice_details: { email: '', company: '', tax_id: '' },
        invoices: [],
        portal_url: 'https://polar.sh',
        ai_credits: { balance: 10000, packs: [] },
      },
    };
    stubFetch();

    const element = await BillingPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Canceled (active until period end)');
    expect(html).toContain('Subscription canceled. Access continues until Oct 1, 2026.');
  });
});
