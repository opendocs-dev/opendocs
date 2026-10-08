import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { BASE_URL, cleanDatabase, signIn, type App } from '../../test/helpers';
import { getPrisma } from '../db';
import { createApp } from '../index';
import { LocalDiskProvider } from '../storage/local';
import { maskPii } from '../assistant/pii';
import { refundCredits, reserveCredits } from '../assistant/chat-service';

const prisma = getPrisma();

const newApp = async (): Promise<App> => {
  const root = await mkdtemp(join(tmpdir(), 'od-assistant-chat-'));
  return createApp(async () => {}, {
    provider: new LocalDiskProvider(root),
    accounts: ['local'],
  });
};

describe('PII masking (AC-20)', () => {
  test('masks email, phone, card, ip, and secrets', () => {
    const fakeKey = ['sk', 'ant', 'api03', 'abcdef1234567890'].join('-');
    const input =
      `Contact user@example.com or call +1 555-123-4567. Card: 4111 2222 3333 4444. IP: 192.168.1.100. Secret: ${fakeKey}`;
    const output = maskPii(input);

    expect(output).not.toContain('user@example.com');
    expect(output).toContain('[EMAIL]');
    expect(output).not.toContain('555-123-4567');
    expect(output).toContain('[PHONE]');
    expect(output).not.toContain('4111 2222 3333 4444');
    expect(output).toContain('[CARD]');
    expect(output).not.toContain('192.168.1.100');
    expect(output).toContain('[IP]');
    expect(output).not.toContain(fakeKey);
    expect(output).toContain('[SECRET]');
  });
});

describe('Credit reservation and refund (AC-18, AC-23)', () => {
  let orgId: string;

  beforeEach(async () => {
    await cleanDatabase();
    orgId = randomUUID();
    await prisma.organization.create({
      data: { id: orgId, name: 'Credit Test Org', slug: 'credit-test-org' },
    });

    // Grant 100 initial credits
    await prisma.aiCreditLedger.create({
      data: {
        organizationId: orgId,
        delta: 100,
        reason: 'admin_grant',
        messageId: 'initial-grant',
        credits: 100,
        balanceAfter: 100,
      },
    });
  });

  afterAll(async () => {
    await cleanDatabase();
  });

  test('reserves credits and refunds on failure', async () => {
    const reservationId = 'test-res-1';

    // 1. Reserve 5 credits
    const res = await reserveCredits(orgId, 5, 'test-model', reservationId);
    expect(res.ok).toBe(true);
    expect(res.balanceAfter).toBe(95);

    // Verify ledger
    const reservedRow = await prisma.aiCreditLedger.findFirst({
      where: { organizationId: orgId, messageId: reservationId, reason: 'reply_reservation' },
    });
    expect(reservedRow?.delta).toBe(-5);
    expect(reservedRow?.balanceAfter).toBe(95);

    // 2. Refund credits
    const refund = await refundCredits(orgId, 5, 'test-model', reservationId);
    expect(refund.ok).toBe(true);
    expect(refund.balanceAfter).toBe(100);

    const refundedRow = await prisma.aiCreditLedger.findFirst({
      where: { organizationId: orgId, messageId: reservationId, reason: 'reply_refund' },
    });
    expect(refundedRow?.delta).toBe(5);
    expect(refundedRow?.balanceAfter).toBe(100);
  });

  test('refundCredits is idempotent per reservation id (second call is no-op)', async () => {
    const reservationId = 'test-res-idempotent';

    await reserveCredits(orgId, 5, 'test-model', reservationId);
    const refund1 = await refundCredits(orgId, 5, 'test-model', reservationId);
    expect(refund1.ok).toBe(true);
    expect(refund1.balanceAfter).toBe(100);

    // Second refund with the exact same reservation id is a no-op
    const refund2 = await refundCredits(orgId, 5, 'test-model', reservationId);
    expect(refund2.ok).toBe(true);
    expect(refund2.balanceAfter).toBe(100);

    const refundRows = await prisma.aiCreditLedger.findMany({
      where: { organizationId: orgId, messageId: reservationId, reason: 'reply_refund' },
    });
    expect(refundRows.length).toBe(1);
  });

  test('fails reservation when credits are insufficient', async () => {
    const res = await reserveCredits(orgId, 200, 'test-model', 'res-over-limit');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('out_of_credits');
  });
});

describe('Public Chat API (UI-R6, AC-18)', () => {
  let app: App;

  beforeEach(async () => {
    await cleanDatabase();
    app = await newApp();
  });

  afterAll(async () => {
    await cleanDatabase();
  });

  test('retrieves only from published guides with steps and tenant isolation', async () => {
    await signIn(app);
    const sessionA = await prisma.session.findFirstOrThrow({
      where: { activeOrganizationId: { not: null } },
      orderBy: { createdAt: 'desc' },
    });
    const orgA = await prisma.organization.findUniqueOrThrow({
      where: { id: sessionA.activeOrganizationId! },
    });

    // Upgrade org A to pro plan and enable AI assistant
    await prisma.workspaceBilling.upsert({
      where: { organizationId: orgA.id },
      update: { plan: 'pro' },
      create: { organizationId: orgA.id, plan: 'pro' },
    });

    await prisma.aiAssistant.upsert({
      where: { organizationId: orgA.id },
      update: { enabled: true, name: 'OrgA Assistant' },
      create: { organizationId: orgA.id, enabled: true, name: 'OrgA Assistant' },
    });

    // Grant credits
    await prisma.aiCreditLedger.create({
      data: {
        organizationId: orgA.id,
        delta: 100,
        reason: 'admin_grant',
        messageId: 'grant-a',
        credits: 100,
        balanceAfter: 100,
      },
    });

    // Create a published flow with steps in Org A
    const runAId = randomUUID();
    const flowAId = randomUUID();
    await prisma.flow.create({
      data: {
        id: flowAId,
        publicId: 'flow-pub-a',
        organizationId: orgA.id,
        slug: 'whatsapp-template',
        title: 'Create a WhatsApp message template',
        visibility: 'published',
        latestRunId: runAId,
      },
    });

    await prisma.run.create({
      data: {
        id: runAId,
        publicId: 'run-pub-a',
        flowId: flowAId,
        status: 'compiled',
      },
    });

    await prisma.step.createMany({
      data: [
        {
          id: randomUUID(),
          runId: runAId,
          order: 1,
          action: 'click',
          instruction: 'Open the dashboard and navigate to messaging.',
        },
        {
          id: randomUUID(),
          runId: runAId,
          order: 2,
          action: 'click',
          instruction: 'Click Create Template in the top right.',
        },
        {
          id: randomUUID(),
          runId: runAId,
          order: 3,
          action: 'click',
          instruction: 'Configure your WhatsApp template fields and click Save.',
        },
      ],
    });

    // Create a draft flow in Org A (should NOT be retrieved)
    const runDraftId = randomUUID();
    const flowDraftId = randomUUID();
    await prisma.flow.create({
      data: {
        id: flowDraftId,
        publicId: 'flow-pub-draft',
        organizationId: orgA.id,
        slug: 'secret-draft',
        title: 'Secret internal draft instructions',
        visibility: 'draft',
        latestRunId: runDraftId,
      },
    });
    await prisma.run.create({
      data: {
        id: runDraftId,
        publicId: 'run-pub-draft',
        flowId: flowDraftId,
        status: 'compiled',
      },
    });
    await prisma.step.create({
      data: {
        id: randomUUID(),
        runId: runDraftId,
        order: 1,
        action: 'click',
        instruction: 'This is private draft information.',
      },
    });

    // Create a published flow in Org B (different tenant, should NOT be retrieved by Org A)
    const orgBId = randomUUID();
    const orgB = await prisma.organization.create({
      data: { id: orgBId, name: 'Org B', slug: 'org-b-tenant' },
    });
    const runBId = randomUUID();
    const flowBId = randomUUID();
    await prisma.flow.create({
      data: {
        id: flowBId,
        publicId: 'flow-pub-b',
        organizationId: orgB.id,
        slug: 'org-b-guide',
        title: 'Org B WhatsApp guide',
        visibility: 'published',
        latestRunId: runBId,
      },
    });
    await prisma.run.create({
      data: {
        id: runBId,
        publicId: 'run-pub-b',
        flowId: flowBId,
        status: 'compiled',
      },
    });
    await prisma.step.create({
      data: {
        id: randomUUID(),
        runId: runBId,
        order: 1,
        action: 'click',
        instruction: 'Org B confidential WhatsApp step.',
      },
    });

    // 1. Ask a matching question on Org A
    const chatRes = await app.handle(
      new Request(`${BASE_URL}/api/v1/site/${orgA.slug}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: 'How do I create a WhatsApp template?',
          visitor_id: 'visitor-123',
        }),
      }),
    );

    expect(chatRes.status).toBe(200);
    const chatBody = (await chatRes.json()) as {
      status: string;
      content: string;
      sources: Array<{ slug: string; title: string; step_range: string }>;
      conversation_id: string;
      message_id: string;
    };

    expect(chatBody.status).toBe('answered');
    expect(chatBody.content).toContain('WhatsApp');
    expect(chatBody.sources.length).toBeGreaterThan(0);
    expect(chatBody.sources[0]?.slug).toBe('whatsapp-template');
    expect(chatBody.sources[0]?.title).toBe('Create a WhatsApp message template');
    expect(chatBody.content).not.toContain('Org B confidential');
    expect(chatBody.content).not.toContain('Secret internal draft');

    // 2. Rate message helpful
    const voteRes = await app.handle(
      new Request(`${BASE_URL}/api/v1/site/${orgA.slug}/chat/${chatBody.message_id}/vote`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          helpful: true,
          feedback: 'Very helpful steps!',
          visitor_id: 'visitor-123',
        }),
      }),
    );
    expect(voteRes.status).toBe(200);

    const updatedMsg = await prisma.aiMessage.findUnique({
      where: { id: chatBody.message_id },
    });
    expect(updatedMsg?.rating).toBe('helpful');
    expect(updatedMsg?.feedback).toBe('Very helpful steps!');

    // 3. Asking question on non-existent or unrelated topic returns no_match
    const noMatchRes = await app.handle(
      new Request(`${BASE_URL}/api/v1/site/${orgA.slug}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: 'How to bake sourdough bread in outer space?',
          visitor_id: 'visitor-123',
        }),
      }),
    );

    expect(noMatchRes.status).toBe(200);
    const noMatchBody = (await noMatchRes.json()) as { status: string; content: string };
    expect(noMatchBody.status).toBe('no_match');
    expect(noMatchBody.content).toContain('I could not find this in our guides');
  });

  test('enforces rate limits per visitor and daily cap', async () => {
    const orgId = randomUUID();
    const org = await prisma.organization.create({
      data: { id: orgId, name: 'Rate Org', slug: 'rate-org' },
    });
    await prisma.workspaceBilling.create({
      data: { organizationId: org.id, plan: 'pro' },
    });
    await prisma.aiAssistant.create({
      data: {
        organizationId: org.id,
        enabled: true,
        hourlyPerVisitor: 2, // Limit 2 per hour
        dailyCap: 10,
      },
    });
    await prisma.aiCreditLedger.create({
      data: {
        organizationId: org.id,
        delta: 100,
        reason: 'admin_grant',
        messageId: 'grant-rate',
        credits: 100,
        balanceAfter: 100,
      },
    });

    const sendMsg = (vid: string) =>
      app.handle(
        new Request(`${BASE_URL}/api/v1/site/${org.slug}/chat`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message: 'Hello query', visitor_id: vid }),
        }),
      );

    // Visitor 1: request 1 & 2 succeed
    const r1 = await sendMsg('vis-1');
    expect(r1.status).toBe(200);
    const r2 = await sendMsg('vis-1');
    expect(r2.status).toBe(200);

    // Visitor 1: request 3 hits hourly limit (429)
    const r3 = await sendMsg('vis-1');
    expect(r3.status).toBe(429);

    // Visitor 2 can still make requests within their own limit
    const r4 = await sendMsg('vis-2');
    expect(r4.status).toBe(200);
  });

  test('validates visitor_id (max 64 chars, [A-Za-z0-9_-] only, otherwise 422)', async () => {
    const orgId = randomUUID();
    const org = await prisma.organization.create({
      data: { id: orgId, name: 'Visitor Validation Org', slug: 'visitor-val-org' },
    });
    await prisma.workspaceBilling.create({
      data: { organizationId: org.id, plan: 'pro' },
    });
    await prisma.aiAssistant.create({
      data: { organizationId: org.id, enabled: true },
    });

    const sendWithVid = (vid: unknown) =>
      app.handle(
        new Request(`${BASE_URL}/api/v1/site/${org.slug}/chat`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message: 'Hello', visitor_id: vid }),
        }),
      );

    // Invalid characters (spaces, special symbols, XSS attempt)
    const r1 = await sendWithVid('visitor with spaces');
    expect(r1.status).toBe(422);

    const r2 = await sendWithVid('<script>alert(1)</script>');
    expect(r2.status).toBe(422);

    const r3 = await sendWithVid('visitor!@#$%^&*()');
    expect(r3.status).toBe(422);

    // Exceeding 64 characters
    const r4 = await sendWithVid('a'.repeat(65));
    expect(r4.status).toBe(422);

    // Empty string is also invalid
    const r5 = await sendWithVid('');
    expect(r5.status).toBe(422);

    // Non-string visitor_id
    const r6 = await sendWithVid(12345);
    expect(r6.status).toBe(422);
  });

  test('rate-limiting derives key from client IP (X-Forwarded-For first hop) and visitor_id; omitting visitor_id cannot bypass', async () => {
    const orgId = randomUUID();
    const org = await prisma.organization.create({
      data: { id: orgId, name: 'IP Rate Org', slug: 'ip-rate-org' },
    });
    await prisma.workspaceBilling.create({
      data: { organizationId: org.id, plan: 'pro' },
    });
    await prisma.aiAssistant.create({
      data: {
        organizationId: org.id,
        enabled: true,
        hourlyPerVisitor: 2,
        dailyCap: 10,
      },
    });
    await prisma.aiCreditLedger.create({
      data: {
        organizationId: org.id,
        delta: 100,
        reason: 'admin_grant',
        messageId: 'grant-ip-rate',
        credits: 100,
        balanceAfter: 100,
      },
    });

    // Omitting visitor_id derives rate-limit key from client IP + 'anon'
    const sendOmitted = (xff?: string) =>
      app.handle(
        new Request(`${BASE_URL}/api/v1/site/${org.slug}/chat`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(xff ? { 'x-forwarded-for': xff } : {}),
          },
          body: JSON.stringify({ message: 'Hello' }),
        }),
      );

    const ipA = '198.51.100.1';
    const o1 = await sendOmitted(`${ipA}, 10.0.0.1`);
    expect(o1.status).toBe(200);

    const o2 = await sendOmitted(`${ipA}, 10.0.0.2`);
    expect(o2.status).toBe(200);

    // Third request from same IP without visitor_id hits hourly limit (cannot bypass by omitting)
    const o3 = await sendOmitted(`${ipA}, 10.0.0.3`);
    expect(o3.status).toBe(429);

    // Different IP can still send
    const ipB = '198.51.100.2';
    const o4 = await sendOmitted(ipB);
    expect(o4.status).toBe(200);
  });

  test('caps message length at 1000 characters and feedback at 500 characters (422)', async () => {
    const orgId = randomUUID();
    const org = await prisma.organization.create({
      data: { id: orgId, name: 'Cap Org', slug: 'cap-org' },
    });
    await prisma.workspaceBilling.create({
      data: { organizationId: org.id, plan: 'pro' },
    });
    await prisma.aiAssistant.create({
      data: { organizationId: org.id, enabled: true },
    });
    await prisma.aiCreditLedger.create({
      data: {
        organizationId: org.id,
        delta: 100,
        reason: 'admin_grant',
        messageId: 'grant-cap',
        credits: 100,
        balanceAfter: 100,
      },
    });

    // Message of 1001 characters returns 422
    const longMsgRes = await app.handle(
      new Request(`${BASE_URL}/api/v1/site/${org.slug}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: 'a'.repeat(1001),
          visitor_id: 'visitor-cap-test',
        }),
      }),
    );
    expect(longMsgRes.status).toBe(422);

    // Message of exactly 1000 characters succeeds
    const okMsgRes = await app.handle(
      new Request(`${BASE_URL}/api/v1/site/${org.slug}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: 'a'.repeat(1000),
          visitor_id: 'visitor-cap-test',
        }),
      }),
    );
    expect(okMsgRes.status).toBe(200);
    const okBody = (await okMsgRes.json()) as { message_id: string };

    // Rating feedback of 501 characters returns 422
    const longFeedbackRes = await app.handle(
      new Request(`${BASE_URL}/api/v1/site/${org.slug}/chat/${okBody.message_id}/vote`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          helpful: true,
          feedback: 'f'.repeat(501),
          visitor_id: 'visitor-cap-test',
        }),
      }),
    );
    expect(longFeedbackRes.status).toBe(422);

    // Rating feedback of 500 characters succeeds
    const okFeedbackRes = await app.handle(
      new Request(`${BASE_URL}/api/v1/site/${org.slug}/chat/${okBody.message_id}/vote`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          helpful: true,
          feedback: 'f'.repeat(500),
          visitor_id: 'visitor-cap-test',
        }),
      }),
    );
    expect(okFeedbackRes.status).toBe(200);
  });

  test('ratings: only the owner visitor key can rate (others get 404), and second vote returns 409', async () => {
    // Documented in test: One vote per message: a second vote returns 409
    const orgId = randomUUID();
    const org = await prisma.organization.create({
      data: { id: orgId, name: 'Vote Org', slug: 'vote-org' },
    });
    await prisma.workspaceBilling.create({
      data: { organizationId: org.id, plan: 'pro' },
    });
    await prisma.aiAssistant.create({
      data: { organizationId: org.id, enabled: true },
    });
    await prisma.aiCreditLedger.create({
      data: {
        organizationId: org.id,
        delta: 100,
        reason: 'admin_grant',
        messageId: 'grant-vote-org',
        credits: 100,
        balanceAfter: 100,
      },
    });

    const ownerIp = '198.51.100.10';
    const ownerVid = 'owner-visitor-99';

    // 1. Create a chat message as owner
    const chatRes = await app.handle(
      new Request(`${BASE_URL}/api/v1/site/${org.slug}/chat`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': ownerIp,
        },
        body: JSON.stringify({
          message: 'Hello question',
          visitor_id: ownerVid,
        }),
      }),
    );
    expect(chatRes.status).toBe(200);
    const chatBody = (await chatRes.json()) as { message_id: string };

    // 2. Another visitor (different visitor_id) on the same IP gets 404
    const attackerVidRes = await app.handle(
      new Request(`${BASE_URL}/api/v1/site/${org.slug}/chat/${chatBody.message_id}/vote`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': ownerIp,
        },
        body: JSON.stringify({
          helpful: true,
          visitor_id: 'attacker-visitor-88',
        }),
      }),
    );
    expect(attackerVidRes.status).toBe(404);

    // 3. Same visitor_id on a different IP gets 404
    const attackerIpRes = await app.handle(
      new Request(`${BASE_URL}/api/v1/site/${org.slug}/chat/${chatBody.message_id}/vote`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': '203.0.113.88',
        },
        body: JSON.stringify({
          helpful: true,
          visitor_id: ownerVid,
        }),
      }),
    );
    expect(attackerIpRes.status).toBe(404);

    // 4. Same visitor key (same IP and same visitor_id) succeeds on first vote
    const ownerVoteRes = await app.handle(
      new Request(`${BASE_URL}/api/v1/site/${org.slug}/chat/${chatBody.message_id}/vote`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': ownerIp,
        },
        body: JSON.stringify({
          helpful: true,
          feedback: 'Great answer!',
          visitor_id: ownerVid,
        }),
      }),
    );
    expect(ownerVoteRes.status).toBe(200);

    // 5. Second vote by the same visitor returns 409 (One vote per message)
    const secondVoteRes = await app.handle(
      new Request(`${BASE_URL}/api/v1/site/${org.slug}/chat/${chatBody.message_id}/vote`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': ownerIp,
        },
        body: JSON.stringify({
          helpful: false,
          feedback: 'Changed my mind',
          visitor_id: ownerVid,
        }),
      }),
    );
    expect(secondVoteRes.status).toBe(409);
  });
});
