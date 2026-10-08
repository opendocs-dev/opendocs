import crypto from 'node:crypto';
import { Elysia } from 'elysia';
import { validateEvent, WebhookVerificationError } from '@polar-sh/sdk/webhooks';
import { getPrisma } from '../db';
import { ApiError } from '../errors';
import { requireMember, requireSession } from '../site/session';
import { normalizeRole } from '../site/role';
import { recordAuditLog } from '../audit/audit-log';
import { getPlan } from '../plan';
import { getPolarClient } from '../polar';

const forbidden = () =>
  new ApiError(403, 'unauthorized', 'Only the owner can view or manage billing');
const invalid = (message: string) =>
  new ApiError(422, 'validation_failed', message);

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseOrgMetadata(raw: string | null | undefined): Record<string, any> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, any>;
    }
  } catch {
    // ignore
  }
  return {};
}

export function parsePayloadDate(raw: unknown, fieldName: string): Date | null {
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }
  if (typeof raw === 'string' || typeof raw === 'number' || raw instanceof Date) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      return d;
    }
  }
  console.warn(`[billing/webhook] Invalid date provided for ${fieldName}:`, raw);
  return null;
}

const readJsonBody = async (request: Request): Promise<Record<string, any>> => {
  const text = await request.text().catch(() => {
    throw invalid('A JSON request body is required');
  });

  let parsed: unknown = {};
  if (text.trim().length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw invalid('Request body must be valid JSON');
    }
  }

  return (parsed as Record<string, any>) ?? {};
};

const formatCurrency = (cents: number, currency: string) => {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `${currency.toUpperCase()} ${(cents / 100).toFixed(2)}`;
  }
};

export function verifyStandardWebhook(
  rawBody: string,
  headers: Headers | Record<string, string>,
  secret: string | undefined,
): boolean {
  if (!secret) return false;
  const getHeader = (name: string): string | null => {
    if ('get' in headers && typeof (headers as any).get === 'function') {
      return (headers as Headers).get(name);
    }
    return (headers as Record<string, string>)[name] ?? (headers as Record<string, string>)[name.toLowerCase()] ?? null;
  };

  const webhookId = getHeader('webhook-id');
  const webhookTimestamp = getHeader('webhook-timestamp');
  const webhookSignature = getHeader('webhook-signature');

  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    return false;
  }

  if (!/^\d+$/.test(webhookTimestamp)) {
    return false;
  }

  const timestamp = parseInt(webhookTimestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > 300) {
    return false;
  }

  const secretBytes = Buffer.from(secret, 'utf8');
  const payload = `${webhookId}.${webhookTimestamp}.${rawBody}`;
  const computedDigest = crypto.createHmac('sha256', secretBytes).update(payload).digest();

  const signatures = webhookSignature.split(' ');
  for (const sig of signatures) {
    const sigPart = sig.startsWith('v1,') ? sig.slice(3) : sig;
    try {
      const sigBytes = Buffer.from(sigPart, 'base64');
      if (sigBytes.length === computedDigest.length && crypto.timingSafeEqual(sigBytes, computedDigest)) {
        return true;
      }
    } catch {
      // continue checking
    }
  }

  return false;
}

export const billingRoute = new Elysia()
  .get('/api/v1/billing', async ({ request }) => {
    const { userId, organizationId } = await requireSession(request);
    const caller = await requireMember(userId, organizationId);
    if (normalizeRole(caller.role) !== 'owner') {
      throw forbidden();
    }

    const prisma = getPrisma();
    const currentPlan = await getPlan(organizationId);
    const [billing, org, latestLedger] = await Promise.all([
      prisma.workspaceBilling.findUnique({ where: { organizationId } }),
      prisma.organization.findUnique({ where: { id: organizationId }, select: { metadata: true } }),
      prisma.aiCreditLedger.findFirst({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const plan = billing?.plan ?? currentPlan;

    const metadata = parseOrgMetadata(org?.metadata);

    const status = billing?.status ?? (plan === 'free' ? 'free' : 'active');
    const cancelAtPeriodEnd = Boolean(billing?.cancelAtPeriodEnd);

    let nextInvoiceDate: string | null = null;
    if (billing?.periodEnd) {
      nextInvoiceDate = billing.periodEnd.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    }

    // Payment method summary comes from Polar API if offered, else null (UI shows Manage in portal)
    const paymentMethod = null;

    // Invoice details from metadata
    const invoiceDetails = {
      email: metadata.invoiceDetails?.email ?? '',
      company: metadata.invoiceDetails?.company ?? '',
      tax_id: metadata.invoiceDetails?.taxId ?? '',
    };

    // Invoices from Polar orders
    let invoices: Array<{
      id: string;
      date: string;
      number: string;
      amount: string;
      status: string;
      pdf_url: string | null;
    }> = [];
    let invoicesUnavailable = false;

    if (billing?.polarCustomerId) {
      const polar = getPolarClient();
      try {
        const ordersRes: any = await polar.orders.list({ customerId: billing.polarCustomerId });
        const items: any[] = ordersRes?.result?.items ?? ordersRes?.items ?? (Array.isArray(ordersRes) ? ordersRes : []);
        invoices = await Promise.all(
          items.map(async (order: any) => {
            const dateStr = order.createdAt
              ? new Date(order.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
              : '';
            const currency = order.currency ?? 'usd';
            const amountCents = typeof order.totalAmount === 'number'
              ? order.totalAmount
              : typeof order.amount === 'number'
              ? order.amount
              : 0;
            const amountStr = formatCurrency(amountCents, currency);

            let pdfUrl: string | null = order.invoice_url ?? order.invoiceUrl ?? null;
            if (!pdfUrl && typeof polar.orders?.invoice === 'function') {
              try {
                const invRes = await polar.orders.invoice({ id: order.id });
                pdfUrl = invRes?.url ?? null;
              } catch {
                pdfUrl = null;
              }
            }

            return {
              id: order.id,
              date: dateStr,
              number: order.invoiceNumber ?? order.invoice_number ?? order.id,
              amount: amountStr,
              status: order.status ?? 'paid',
              pdf_url: pdfUrl,
            };
          }),
        );
      } catch (err) {
        console.error('[billing] Failed to load orders from Polar:', err);
        invoicesUnavailable = true;
        invoices = [];
      }
    }

    // AI Credits: single source of truth is latest ledger entry balanceAfter (resets monthly via job)
    const balance = latestLedger?.balanceAfter ?? 0;

    return {
      subscription: {
        plan,
        status,
        billing_cycle: 'monthly',
        next_invoice_date: nextInvoiceDate,
        period_end: billing?.periodEnd?.toISOString() ?? null,
        cancel_at_period_end: cancelAtPeriodEnd,
      },
      payment_method: paymentMethod,
      invoice_details: invoiceDetails,
      invoices,
      invoices_unavailable: invoicesUnavailable,
      portal_url: null,
      ai_credits: {
        balance,
        packs: [
          { credits: 1000, price: 'Price to be set' },
          { credits: 5000, price: 'Price to be set' },
          { credits: 20000, price: 'Price to be set' },
        ],
      },
    };
  })
  .post('/api/v1/billing/checkout', async ({ request }) => {
    const { userId, organizationId } = await requireSession(request);
    const caller = await requireMember(userId, organizationId);
    if (normalizeRole(caller.role) !== 'owner') {
      throw forbidden();
    }

    // Checkout guard rule:
    // Workspaces with an active paid subscription (pro or enterprise) cannot check out.
    // Enterprise workspaces can never self-serve check out Pro.
    // Workspaces canceled at period end must wait until periodEnd has passed to re-subscribe via checkout,
    // or use the customer portal to resume their subscription.
    const prisma = getPrisma();
    const currentBilling = await prisma.workspaceBilling.findUnique({ where: { organizationId } });
    const currentPlan = currentBilling?.plan ?? (await getPlan(organizationId));
    const currentStatus = currentBilling?.status ?? (currentPlan === 'free' ? 'free' : 'active');

    if (currentPlan === 'enterprise') {
      return new Response(
        JSON.stringify({
          error: {
            code: 'conflict',
            message: 'Enterprise workspaces cannot self-serve check out Pro',
          },
        }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      );
    }

    const isCanceledAtPeriodEnd = Boolean(currentBilling?.cancelAtPeriodEnd) || currentStatus === 'canceled_at_period_end';
    const periodEndActive = !currentBilling?.periodEnd || currentBilling.periodEnd.getTime() > Date.now();

    if (isCanceledAtPeriodEnd && periodEndActive) {
      return new Response(
        JSON.stringify({
          error: {
            code: 'canceled_subscription_active',
            message: 'Subscription is active until period end. Please manage or resume in customer portal.',
          },
        }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      );
    }

    if (
      currentPlan === 'pro' &&
      (currentStatus === 'active' ||
        currentStatus === 'trialing' ||
        currentStatus === 'past_due' ||
        (!isCanceledAtPeriodEnd && (!currentBilling?.periodEnd || currentBilling.periodEnd.getTime() > Date.now())))
    ) {
      return new Response(
        JSON.stringify({ error: { code: 'conflict', message: 'Already on Pro plan' } }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      );
    }

    const body = await readJsonBody(request);
    const interval = body.interval;
    if (interval !== 'monthly' && interval !== 'yearly') {
      throw invalid('Interval must be monthly or yearly');
    }

    const productId = interval === 'monthly'
      ? process.env.POLAR_PRODUCT_PRO_MONTHLY
      : process.env.POLAR_PRODUCT_PRO_YEARLY;

    if (!productId) {
      return new Response(
        JSON.stringify({ error: { code: 'server_misconfigured', message: 'Billing product is not configured' } }),
        { status: 500, headers: { 'content-type': 'application/json' } },
      );
    }

    const polar = getPolarClient();
    let checkout: any;
    try {
      checkout = await polar.checkouts.create({
        products: [productId],
        externalCustomerId: organizationId,
      });
    } catch (err: any) {
      console.error('[billing/checkout] Polar checkout creation failed:', err);
      return new Response(
        JSON.stringify({
          error: {
            code: 'polar_api_error',
            message: 'Failed to initialize checkout with billing provider',
          },
        }),
        { status: 502, headers: { 'content-type': 'application/json' } },
      );
    }

    return { url: checkout.url };
  })
  .post('/api/v1/billing/portal', async ({ request }) => {
    const { userId, organizationId } = await requireSession(request);
    const caller = await requireMember(userId, organizationId);
    if (normalizeRole(caller.role) !== 'owner') {
      throw forbidden();
    }

    const prisma = getPrisma();
    const billing = await prisma.workspaceBilling.findUnique({ where: { organizationId } });
    const polar = getPolarClient();

    const isNotFound = (err: any) =>
      err?.statusCode === 404 ||
      err?.status === 404 ||
      err?.name === 'ResourceNotFound' ||
      err?.constructor?.name === 'ResourceNotFound';

    let session: any;
    try {
      if (billing?.polarCustomerId) {
        try {
          session = await polar.customerSessions.create({ customerId: billing.polarCustomerId });
        } catch (err: any) {
          if (isNotFound(err)) {
            session = await polar.customerSessions.create({ externalCustomerId: organizationId });
          } else {
            throw err;
          }
        }
      } else {
        session = await polar.customerSessions.create({ externalCustomerId: organizationId });
      }
    } catch (err: any) {
      if (isNotFound(err)) {
        return new Response(
          JSON.stringify({
            error: {
              code: 'no_polar_customer',
              message: 'No billing customer found for this workspace',
            },
          }),
          { status: 409, headers: { 'content-type': 'application/json' } },
        );
      }
      console.error('[billing/portal] Polar customerSession creation failed:', err);
      return new Response(
        JSON.stringify({
          error: {
            code: 'polar_api_error',
            message: 'Failed to create customer portal session',
          },
        }),
        { status: 502, headers: { 'content-type': 'application/json' } },
      );
    }

    const portalUrl = session?.customerPortalUrl ?? session?.customer_portal_url ?? session?.url;
    if (!portalUrl) {
      return new Response(
        JSON.stringify({ error: { code: 'polar_api_error', message: 'Failed to create customer portal session' } }),
        { status: 502, headers: { 'content-type': 'application/json' } },
      );
    }

    await recordAuditLog({
      actorKind: 'user',
      actorId: userId,
      organizationId,
      action: 'Opened payment portal',
      detail: { type: 'billing' },
    });

    return { url: portalUrl };
  })
  .patch('/api/v1/billing/invoice-details', async ({ request }) => {
    const { userId, organizationId } = await requireSession(request);
    const caller = await requireMember(userId, organizationId);
    if (normalizeRole(caller.role) !== 'owner') {
      throw forbidden();
    }

    const body = await readJsonBody(request);
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const company = typeof body.company === 'string' ? body.company.trim() : '';
    const taxId = typeof body.tax_id === 'string' ? body.tax_id.trim() : typeof body.taxId === 'string' ? body.taxId.trim() : '';

    if (email && !EMAIL_REGEX.test(email)) {
      throw invalid('Invalid email address format');
    }
    if (company.length > 120) {
      throw invalid('Company name must be at most 120 characters');
    }
    if (taxId.length > 40) {
      throw invalid('Tax ID must be at most 40 characters');
    }

    const prisma = getPrisma();
    await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ metadata: string | null }[]>`
        SELECT metadata FROM "Organization" WHERE id = ${organizationId} FOR UPDATE
      `;
      const metadata = parseOrgMetadata(rows[0]?.metadata);

      metadata.invoiceDetails = { email, company, taxId };

      await tx.organization.update({
        where: { id: organizationId },
        data: { metadata: JSON.stringify(metadata) },
      });
    });

    // PII protection: log only that invoice details changed, do NOT log email/company/taxId
    await recordAuditLog({
      actorKind: 'user',
      actorId: userId,
      organizationId,
      action: 'Updated billing invoice details',
      detail: { type: 'billing', changed: ['invoice_details'] },
    });

    return {
      success: true,
      invoice_details: {
        email,
        company,
        tax_id: taxId,
      },
    };
  })
  .post('/api/v1/billing/webhook', async ({ request }) => {
    const secret = process.env.POLAR_WEBHOOK_SECRET;
    if (!secret) {
      return new Response(
        JSON.stringify({ error: { code: 'server_misconfigured', message: 'Webhook secret is not configured' } }),
        { status: 500, headers: { 'content-type': 'application/json' } },
      );
    }

    const webhookId = request.headers.get('webhook-id');
    if (!webhookId) {
      return new Response(
        JSON.stringify({ error: { code: 'unauthorized', message: 'Missing webhook-id header' } }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      );
    }

    const webhookTimestamp = request.headers.get('webhook-timestamp');
    if (!webhookTimestamp || !/^\d+$/.test(webhookTimestamp)) {
      return new Response(
        JSON.stringify({ error: { code: 'unauthorized', message: 'Invalid or missing webhook-timestamp header' } }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      );
    }

    const webhookSignature = request.headers.get('webhook-signature');
    if (!webhookSignature) {
      return new Response(
        JSON.stringify({ error: { code: 'unauthorized', message: 'Missing webhook-signature header' } }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      );
    }

    const rawBody = await request.text().catch(() => '');

    const webhookHeaders: Record<string, string> = {};
    request.headers.forEach((v, k) => {
      webhookHeaders[k.toLowerCase()] = v;
    });

    try {
      validateEvent(rawBody, webhookHeaders, secret);
    } catch (err: any) {
      if (err instanceof WebhookVerificationError || err?.constructor?.name === 'WebhookVerificationError') {
        return new Response(
          JSON.stringify({ error: { code: 'unauthorized', message: 'Invalid webhook signature' } }),
          { status: 401, headers: { 'content-type': 'application/json' } },
        );
      }
      if (!verifyStandardWebhook(rawBody, request.headers, secret)) {
        return new Response(
          JSON.stringify({ error: { code: 'unauthorized', message: 'Invalid webhook signature' } }),
          { status: 401, headers: { 'content-type': 'application/json' } },
        );
      }
    }

    let body: any;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return new Response(
        JSON.stringify({ error: { code: 'validation_failed', message: 'Invalid JSON payload' } }),
        { status: 422, headers: { 'content-type': 'application/json' } },
      );
    }

    const eventType: string = typeof body.type === 'string' ? body.type : '';
    const HANDLED_EVENTS = [
      'subscription.created',
      'subscription.updated',
      'subscription.active',
      'subscription.canceled',
      'subscription.revoked',
      'order.paid',
    ];

    if (!HANDLED_EVENTS.includes(eventType)) {
      console.log(`[billing/webhook] Ignored unhandled event type: ${eventType}`);
      return { received: true, ignored: true };
    }

    const data = typeof body.data === 'object' && body.data !== null ? body.data : {};
    const prisma = getPrisma();

    // 1. Resolve workspace first
    const customerId: string | null =
      typeof data.customer_id === 'string' ? data.customer_id :
      (typeof data.customerId === 'string' ? data.customerId :
      (typeof data.customer?.id === 'string' ? data.customer.id : null));

    const customerExternalId: string | null =
      typeof data.customer?.external_id === 'string' ? data.customer.external_id :
      (typeof data.customer?.externalId === 'string' ? data.customer.externalId :
      (typeof data.external_customer_id === 'string' ? data.external_customer_id :
      (typeof data.externalCustomerId === 'string' ? data.externalCustomerId : null)));

    let org: { id: string } | null = null;
    if (customerId) {
      const billing = await prisma.workspaceBilling.findFirst({
        where: { polarCustomerId: customerId },
        select: { organizationId: true },
      });
      if (billing) {
        org = { id: billing.organizationId };
      }
    }

    if (!org && customerExternalId) {
      org = await prisma.organization.findUnique({
        where: { id: customerExternalId },
        select: { id: true },
      });
    }

    if (!org) {
      console.warn('[billing/webhook] Unknown customer in event', { customerId, customerExternalId });
      return { received: true, ignored: 'unknown_customer' };
    }

    const organizationId = org.id;

    // 2. Validate product / order fields before transaction
    let credits: number | undefined;
    let orderId: string | null = null;

    if (eventType === 'order.paid') {
      const productId: string | undefined = data.product_id ?? data.productId;
      const packMap: Record<string, number> = {};
      if (process.env.POLAR_PRODUCT_CREDITS_1000) packMap[process.env.POLAR_PRODUCT_CREDITS_1000] = 1000;
      if (process.env.POLAR_PRODUCT_CREDITS_5000) packMap[process.env.POLAR_PRODUCT_CREDITS_5000] = 5000;
      if (process.env.POLAR_PRODUCT_CREDITS_20000) packMap[process.env.POLAR_PRODUCT_CREDITS_20000] = 20000;

      credits = productId ? packMap[productId] : undefined;
      if (!credits) {
        console.log(`[billing/webhook] order.paid ignored for unmapped product: ${productId}`);
        return { received: true, ignored: 'unmapped_product' };
      }

      orderId = typeof data.id === 'string' && data.id.trim() ? data.id.trim() : null;
      if (!orderId) {
        console.warn('[billing/webhook] order.paid missing non-null order id in data.id');
        return { received: true, ignored: 'missing_order_id' };
      }
    } else {
      // Subscription events
      // Requirement D: Canceled, revoked and updated events must also check that data.product_id maps to a plan product env var
      const productId: string | undefined = data.product_id ?? data.productId;
      const isProProduct = Boolean(
        productId && (
          productId === process.env.POLAR_PRODUCT_PRO_MONTHLY ||
          productId === process.env.POLAR_PRODUCT_PRO_YEARLY
        )
      );

      if (!isProProduct) {
        console.log(`[billing/webhook] subscription event with unknown product id: ${productId}`);
        return { received: true, ignored: 'unknown_product_id' };
      }
    }

    // 3. For applied events: insert BillingEvent and billing write in one transaction
    // Catch P2002 OUTSIDE the interactive transaction
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.billingEvent.create({
          data: { eventId: webhookId, receivedAt: new Date() },
        });

        if (eventType === 'order.paid') {
          // Lock Organization row
          await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;

          const existingOrder = await tx.aiCreditLedger.findFirst({
            where: { orderId: orderId! },
          });
          if (existingOrder) {
            return { received: true, duplicate: true };
          }

          const latest = await tx.aiCreditLedger.findFirst({
            where: { organizationId },
            orderBy: { createdAt: 'desc' },
          });
          const currentBalance = latest?.balanceAfter ?? 0;
          const newBalance = currentBalance + credits!;

          await tx.aiCreditLedger.create({
            data: {
              organizationId,
              delta: credits!,
              reason: 'purchase',
              orderId: orderId!,
              credits: credits!,
              balanceAfter: newBalance,
            },
          });

          if (customerId) {
            await tx.workspaceBilling.upsert({
              where: { organizationId },
              update: { polarCustomerId: customerId },
              create: { organizationId, plan: 'free', polarCustomerId: customerId },
            });
          }

          return { received: true };
        }

        // Subscription write (Requirement C: Lock WorkspaceBilling row after creating if missing, re-read)
        await tx.workspaceBilling.upsert({
          where: { organizationId },
          update: {},
          create: { organizationId, plan: 'free' },
        });

        await tx.$queryRaw`SELECT "organizationId" FROM "WorkspaceBilling" WHERE "organizationId" = ${organizationId} FOR UPDATE`;

        const existingBilling = await tx.workspaceBilling.findUnique({ where: { organizationId } });

        const subscriptionId: string | null =
          typeof data.id === 'string' ? data.id : (typeof data.subscription_id === 'string' ? data.subscription_id : null);
        const eventModifiedAtRaw = data.modified_at ?? data.modifiedAt ?? data.created_at ?? data.createdAt;
        const eventModifiedAt = parsePayloadDate(eventModifiedAtRaw, 'modified_at');
        const currentPeriodEndRaw = data.current_period_end ?? data.currentPeriodEnd;
        const periodEnd = parsePayloadDate(currentPeriodEndRaw, 'current_period_end');
        const cancelAtPeriodEnd = Boolean(data.cancel_at_period_end ?? data.cancelAtPeriodEnd);
        const rawStatus: string = typeof data.status === 'string' ? data.status : '';

        // Requirement B: Stale-subscription guard
        const storedSubId = existingBilling?.polarSubscriptionId ?? null;

        if (storedSubId && subscriptionId && subscriptionId !== storedSubId) {
          const isGenuineNewSub =
            eventType === 'subscription.created' && (rawStatus === 'active' || rawStatus === 'trialing');
          if (!isGenuineNewSub) {
            console.log(
              `[billing/webhook] Ignored event for outdated subscription ${subscriptionId} (current: ${storedSubId})`,
            );
            return { received: true, ignored: 'outdated_subscription' };
          }
          if (existingBilling?.lastModifiedAt) {
            if (!eventModifiedAt || eventModifiedAt.getTime() <= existingBilling.lastModifiedAt.getTime()) {
              console.log(
                `[billing/webhook] Ignored outdated subscription created event ${subscriptionId} (${eventModifiedAt?.toISOString()} <= ${existingBilling.lastModifiedAt.toISOString()})`,
              );
              return { received: true, ignored: 'outdated_subscription' };
            }
          }
        }

        if (!storedSubId) {
          const canSetInitialSub =
            eventType === 'subscription.created' ||
            (eventType === 'subscription.active' && (rawStatus === 'active' || rawStatus === 'trialing'));
          if (!canSetInitialSub) {
            console.log(
              `[billing/webhook] Ignored unlinked subscription event ${eventType} (${rawStatus}) with no stored subscription id`,
            );
            return { received: true, ignored: 'no_stored_subscription' };
          }
        }

        // Ties on modified_at: ignore the event when modified_at is equal to or older than the stored one
        // except when it is the first event for the stored subscription.
        const isFirstEventForSub = !existingBilling?.lastModifiedAt || (storedSubId !== subscriptionId);
        if (!isFirstEventForSub && eventModifiedAt && existingBilling?.lastModifiedAt) {
          if (eventModifiedAt.getTime() <= existingBilling.lastModifiedAt.getTime()) {
            console.log(
              `[billing/webhook] Ignored event equal to or older than stored lastModifiedAt (${eventModifiedAt.toISOString()} <= ${existingBilling.lastModifiedAt.toISOString()})`,
            );
            return { received: true, ignored: 'outdated_timestamp' };
          }
        }

        const lastModifiedAt = eventModifiedAt ?? existingBilling?.lastModifiedAt ?? new Date();

        // Requirement A: Explicit allowlist status mapping
        let plan = existingBilling?.plan ?? 'free';
        let status = rawStatus || 'active';
        let targetCancelAtPeriodEnd = cancelAtPeriodEnd;
        let targetPeriodEnd = periodEnd;

        if (eventType === 'subscription.revoked' || rawStatus === 'revoked') {
          // revoked -> downgrade to free
          plan = 'free';
          status = 'revoked';
          targetCancelAtPeriodEnd = false;
          targetPeriodEnd = null;
        } else if (eventType === 'subscription.canceled' || rawStatus === 'canceled' || cancelAtPeriodEnd) {
          const periodNotEnded = periodEnd !== null && periodEnd.getTime() > Date.now();
          if (periodNotEnded) {
            // canceled with period end in future -> keep pro, canceled_at_period_end
            plan = (existingBilling?.plan === 'pro') ? 'pro' : (existingBilling?.plan ?? 'free');
            status = 'canceled_at_period_end';
            targetCancelAtPeriodEnd = true;
          } else {
            // canceled with period end passed (or null): expired-canceled downgrade to free
            plan = 'free';
            status = 'canceled';
            targetCancelAtPeriodEnd = true;
          }
        } else if (rawStatus === 'active' || rawStatus === 'trialing') {
          // active and trialing -> pro/active
          plan = 'pro';
          status = 'active';
          targetCancelAtPeriodEnd = false;
        } else if (rawStatus === 'past_due') {
          // past_due -> keep pro, status past_due
          plan = existingBilling?.plan === 'pro' ? 'pro' : (existingBilling?.plan ?? 'free');
          status = 'past_due';
        } else if (
          rawStatus === 'incomplete_expired' ||
          rawStatus === 'unpaid' ||
          rawStatus === 'incomplete' ||
          rawStatus === 'paused'
        ) {
          // Non-granting statuses: leave existing plan untouched, record status and log warning
          plan = existingBilling?.plan ?? 'free';
          status = rawStatus;
          console.warn(`[billing/webhook] Non-granting subscription status '${rawStatus}' received; leaving plan as '${plan}'`);
        } else {
          // Any UNKNOWN status: never grant or keep Pro, leave existing plan untouched, record status and log warning
          plan = existingBilling?.plan ?? 'free';
          status = rawStatus || 'unknown';
          console.warn(`[billing/webhook] Unknown subscription status '${rawStatus}' received; leaving plan as '${plan}'`);
        }

        // Requirement D: Never overwrite plan enterprise (staff set) from any Polar event
        // Polar events must not write status, periodEnd or cancelAtPeriodEnd either: record only customer/sub IDs and lastModifiedAt
        if (existingBilling?.plan === 'enterprise') {
          await tx.workspaceBilling.update({
            where: { organizationId },
            data: {
              lastModifiedAt,
              ...(customerId ? { polarCustomerId: customerId } : {}),
              ...(subscriptionId ? { polarSubscriptionId: subscriptionId } : {}),
            },
          });

          return { received: true };
        }

        await tx.workspaceBilling.update({
          where: { organizationId },
          data: {
            plan,
            status,
            cancelAtPeriodEnd: targetCancelAtPeriodEnd,
            lastModifiedAt,
            ...(targetPeriodEnd !== null ? { periodEnd: targetPeriodEnd } : (eventType === 'subscription.revoked' ? { periodEnd: null } : {})),
            ...(customerId ? { polarCustomerId: customerId } : {}),
            ...(subscriptionId ? { polarSubscriptionId: subscriptionId } : {}),
          },
        });

        return { received: true };
      });
    } catch (err: any) {
      // Requirement E: Duplicate detection: catch only a unique violation whose meta.target / constraint refers to BillingEvent (eventId)
      if (err?.code === 'P2002') {
        const target = err?.meta?.target;
        const driverAdapterError = err?.meta?.driverAdapterError;
        const constraint = driverAdapterError?.cause?.constraint?.index ?? driverAdapterError?.cause?.constraint;
        const table = driverAdapterError?.cause?.table;
        const message = typeof err?.message === 'string' ? err.message : '';

        const isBillingEvent =
          (Array.isArray(target) && target.includes('eventId')) ||
          (typeof target === 'string' && (target.includes('eventId') || target.includes('BillingEvent'))) ||
          err?.meta?.modelName === 'BillingEvent' ||
          (typeof constraint === 'string' && constraint.includes('BillingEvent')) ||
          table === 'BillingEvent' ||
          message.includes('BillingEvent');

        if (isBillingEvent) {
          console.log(`[billing/webhook] Duplicate event ${webhookId}`);
          return { received: true, duplicate: true };
        }
      }
      throw err;
    }
  });
