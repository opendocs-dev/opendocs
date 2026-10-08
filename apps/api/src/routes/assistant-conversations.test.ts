import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { BASE_URL, cleanDatabase, signIn, type App } from '../../test/helpers';
import { getPrisma } from '../db';
import { createApp } from '../index';
import { LocalDiskProvider } from '../storage/local';
import { normalizeGapQuery } from '../assistant/chat-service';

const prisma = getPrisma();

const newApp = async (): Promise<App> => {
  const root = await mkdtemp(join(tmpdir(), 'od-convo-test-'));
  return createApp(async () => {}, {
    provider: new LocalDiskProvider(root),
    accounts: ['local'],
  });
};

describe('Content gaps normalization (AC-20, SN2)', () => {
  test('trims, lowercases, and collapses whitespace', () => {
    expect(normalizeGapQuery('  Moving a   WhatsApp Number  ')).toBe('moving a whatsapp number');
    expect(normalizeGapQuery('How to\nreset\tpassword?')).toBe('how to reset password?');
  });
});

describe('Conversations, Content Gaps & Stats API (UI-A12, AC-20)', () => {
  let app: App;

  beforeEach(async () => {
    await cleanDatabase();
    app = await newApp();
  });

  afterAll(async () => {
    await cleanDatabase();
  });

  test('role-based authorization: editor gets 403, free plan gets 403, owner gets 200', async () => {
    const ownerCookie = await signIn(app, { id: 101, login: 'owner-user', email: 'owner@example.com' });
    const session = await prisma.session.findFirstOrThrow({
      where: { activeOrganizationId: { not: null } },
      orderBy: { createdAt: 'desc' },
    });
    const orgId = session.activeOrganizationId!;

    // 1. Free plan: owner gets 403 because AI assistant requires Pro or Enterprise
    const freeRes = await app.handle(
      new Request(`${BASE_URL}/api/v1/assistant/stats`, {
        headers: { cookie: ownerCookie },
      }),
    );
    expect(freeRes.status).toBe(403);

    // Upgrade org to pro
    await prisma.workspaceBilling.upsert({
      where: { organizationId: orgId },
      update: { plan: 'pro' },
      create: { organizationId: orgId, plan: 'pro' },
    });

    // 2. Owner on Pro: gets 200
    const ownerRes = await app.handle(
      new Request(`${BASE_URL}/api/v1/assistant/stats`, {
        headers: { cookie: ownerCookie },
      }),
    );
    expect(ownerRes.status).toBe(200);

    // 3. Editor role in the same org: gets 403
    const editorCookie = await signIn(app, { id: 102, login: 'editor-user', email: 'editor@example.com' });
    const editorSession = await prisma.session.findFirstOrThrow({
      where: { userId: { not: session.userId } },
      orderBy: { createdAt: 'desc' },
    });

    await prisma.member.create({
      data: {
        id: randomUUID(),
        organizationId: orgId,
        userId: editorSession.userId,
        role: 'editor',
      },
    });

    await prisma.session.update({
      where: { id: editorSession.id },
      data: { activeOrganizationId: orgId },
    });

    const editorRes = await app.handle(
      new Request(`${BASE_URL}/api/v1/assistant/stats`, {
        headers: { cookie: editorCookie },
      }),
    );
    expect(editorRes.status).toBe(403);
  });

  test('gap normalization, upsert and grouping from unanswered chat messages', async () => {
    const cookie = await signIn(app);
    const session = await prisma.session.findFirstOrThrow({
      where: { activeOrganizationId: { not: null } },
      orderBy: { createdAt: 'desc' },
    });
    const orgId = session.activeOrganizationId!;
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });

    await prisma.workspaceBilling.upsert({
      where: { organizationId: orgId },
      update: { plan: 'pro' },
      create: { organizationId: orgId, plan: 'pro' },
    });

    await prisma.aiAssistant.upsert({
      where: { organizationId: orgId },
      update: { enabled: true, maskPii: true },
      create: { organizationId: orgId, enabled: true, maskPii: true },
    });

    await prisma.aiCreditLedger.create({
      data: {
        organizationId: orgId,
        delta: 100,
        reason: 'admin_grant',
        messageId: 'grant-test',
        credits: 100,
        balanceAfter: 100,
      },
    });

    // Send first unanswered question
    const chatRes1 = await app.handle(
      new Request(`${BASE_URL}/api/v1/site/${org.slug}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          visitor_id: 'visitor-1',
          message: 'How to move a WhatsApp number?',
        }),
      }),
    );
    expect(chatRes1.status).toBe(200);

    // Send second similar unanswered question with different casing and whitespace
    const chatRes2 = await app.handle(
      new Request(`${BASE_URL}/api/v1/site/${org.slug}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          visitor_id: 'visitor-2',
          message: '  how to move a   whatsapp number?  ',
        }),
      }),
    );
    expect(chatRes2.status).toBe(200);

    // Verify gaps via GET /api/v1/assistant/gaps
    const gapsRes = await app.handle(
      new Request(`${BASE_URL}/api/v1/assistant/gaps`, {
        headers: { cookie },
      }),
    );
    expect(gapsRes.status).toBe(200);
    const gapsBody = (await gapsRes.json()) as { gaps: Array<{ query: string; count: number; status: string }> };
    expect(gapsBody.gaps.length).toBe(1);
    expect(gapsBody.gaps[0].query).toBe('how to move a whatsapp number?');
    expect(gapsBody.gaps[0].count).toBe(2);
    expect(gapsBody.gaps[0].status).toBe('open');
  });

  test('PII is masked in content gaps when maskPii is enabled', async () => {
    const cookie = await signIn(app);
    const session = await prisma.session.findFirstOrThrow({
      where: { activeOrganizationId: { not: null } },
      orderBy: { createdAt: 'desc' },
    });
    const orgId = session.activeOrganizationId!;
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });

    await prisma.workspaceBilling.upsert({
      where: { organizationId: orgId },
      update: { plan: 'pro' },
      create: { organizationId: orgId, plan: 'pro' },
    });

    await prisma.aiAssistant.upsert({
      where: { organizationId: orgId },
      update: { enabled: true, maskPii: true },
      create: { organizationId: orgId, enabled: true, maskPii: true },
    });

    await prisma.aiCreditLedger.create({
      data: {
        organizationId: orgId,
        delta: 100,
        reason: 'admin_grant',
        messageId: 'grant-test',
        credits: 100,
        balanceAfter: 100,
      },
    });

    await app.handle(
      new Request(`${BASE_URL}/api/v1/site/${org.slug}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          visitor_id: 'visitor-pii',
          message: 'My email is secret@company.com and phone is +1 555-987-6543, where is my order?',
        }),
      }),
    );

    const gapsRes = await app.handle(
      new Request(`${BASE_URL}/api/v1/assistant/gaps`, {
        headers: { cookie },
      }),
    );
    const gapsBody = (await gapsRes.json()) as { gaps: Array<{ query: string }> };
    expect(gapsBody.gaps.length).toBe(1);
    expect(gapsBody.gaps[0].query).not.toContain('secret@company.com');
    expect(gapsBody.gaps[0].query).not.toContain('555-987-6543');
    expect(gapsBody.gaps[0].query).toContain('[email]');
    expect(gapsBody.gaps[0].query).toContain('[phone]');
  });

  test('gap actions: dismiss and attach to guide', async () => {
    const cookie = await signIn(app);
    const session = await prisma.session.findFirstOrThrow({
      where: { activeOrganizationId: { not: null } },
      orderBy: { createdAt: 'desc' },
    });
    const orgId = session.activeOrganizationId!;

    await prisma.workspaceBilling.upsert({
      where: { organizationId: orgId },
      update: { plan: 'pro' },
      create: { organizationId: orgId, plan: 'pro' },
    });

    // Create a gap
    const gap = await prisma.aiGap.create({
      data: {
        organizationId: orgId,
        query: 'custom webhooks configuration',
        count: 5,
        status: 'open',
      },
    });

    // Create a flow to attach to
    const flow = await prisma.flow.create({
      data: {
        organizationId: orgId,
        publicId: 'flow-webhooks',
        title: 'Configure Webhooks',
        slug: 'webhooks-guide',
      },
    });

    // Attach to guide
    const attachRes = await app.handle(
      new Request(`${BASE_URL}/api/v1/assistant/gaps/${gap.id}/attach`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ flow_id: flow.id }),
      }),
    );
    expect(attachRes.status).toBe(200);

    const checkAttached = await prisma.aiGap.findUniqueOrThrow({ where: { id: gap.id } });
    expect(checkAttached.status).toBe('recorded');
    expect(checkAttached.flowId).toBe(flow.id);

    // Dismiss gap
    const dismissRes = await app.handle(
      new Request(`${BASE_URL}/api/v1/assistant/gaps/${gap.id}/dismiss`, {
        method: 'POST',
        headers: { cookie },
      }),
    );
    expect(dismissRes.status).toBe(200);

    const checkDismissed = await prisma.aiGap.findUniqueOrThrow({ where: { id: gap.id } });
    expect(checkDismissed.status).toBe('dismissed');
  });

  test('stats counters and CSV export', async () => {
    const cookie = await signIn(app);
    const session = await prisma.session.findFirstOrThrow({
      where: { activeOrganizationId: { not: null } },
      orderBy: { createdAt: 'desc' },
    });
    const orgId = session.activeOrganizationId!;

    await prisma.workspaceBilling.upsert({
      where: { organizationId: orgId },
      update: { plan: 'pro' },
      create: { organizationId: orgId, plan: 'pro' },
    });

    // Create a conversation with an answered and rated message
    const convo1 = await prisma.aiConversation.create({
      data: {
        organizationId: orgId,
        visitorId: 'vis-1',
      },
    });

    await prisma.aiMessage.createMany({
      data: [
        {
          conversationId: convo1.id,
          role: 'user',
          content: 'How do I export data?',
          answered: true,
        },
        {
          conversationId: convo1.id,
          role: 'assistant',
          content: 'Go to Settings and click Export.',
          answered: true,
          rating: 'helpful',
          tokensUsed: 25,
        },
      ],
    });

    // Create an unanswered conversation
    const convo2 = await prisma.aiConversation.create({
      data: {
        organizationId: orgId,
        visitorId: 'vis-2',
      },
    });

    await prisma.aiMessage.createMany({
      data: [
        {
          conversationId: convo2.id,
          role: 'user',
          content: 'Does OpenDocs support Kubernetes?',
          answered: false,
        },
        {
          conversationId: convo2.id,
          role: 'assistant',
          content: 'I could not find this in our guides.',
          answered: false,
          tokensUsed: 15,
        },
      ],
    });

    // Create open gap
    await prisma.aiGap.create({
      data: {
        organizationId: orgId,
        query: 'does opendocs support kubernetes?',
        count: 1,
        status: 'open',
      },
    });

    // Credit ledger entry
    await prisma.aiCreditLedger.create({
      data: {
        organizationId: orgId,
        delta: -40,
        reason: 'reply_charge',
        messageId: 'charge-1',
        credits: 40,
        balanceAfter: 60,
      },
    });

    // Check stats
    const statsRes = await app.handle(
      new Request(`${BASE_URL}/api/v1/assistant/stats?days=30`, {
        headers: { cookie },
      }),
    );
    expect(statsRes.status).toBe(200);
    const stats = (await statsRes.json()) as {
      questions: number;
      answered_percent: number;
      helpful_percent: number;
      content_gaps: number;
      credits_used: number;
    };

    expect(stats.questions).toBe(2);
    expect(stats.answered_percent).toBe(50); // 1 answered out of 2 assistant replies
    expect(stats.helpful_percent).toBe(100); // 1 rated helpful out of 1 rated
    expect(stats.content_gaps).toBe(1);
    expect(stats.credits_used).toBe(40);

    // Check conversations list
    const convoRes = await app.handle(
      new Request(`${BASE_URL}/api/v1/assistant/conversations`, {
        headers: { cookie },
      }),
    );
    expect(convoRes.status).toBe(200);
    const convoList = (await convoRes.json()) as { conversations: Array<{ id: string; question: string; answered: boolean }> };
    expect(convoList.conversations.length).toBe(2);

    // Check detail
    const detailRes = await app.handle(
      new Request(`${BASE_URL}/api/v1/assistant/conversations/${convo1.id}`, {
        headers: { cookie },
      }),
    );
    expect(detailRes.status).toBe(200);
    const detail = (await detailRes.json()) as { conversation: { messages: Array<{ role: string }> } };
    expect(detail.conversation.messages.length).toBe(2);

    // Check CSV export
    const exportRes = await app.handle(
      new Request(`${BASE_URL}/api/v1/assistant/export`, {
        headers: { cookie },
      }),
    );
    expect(exportRes.status).toBe(200);
    expect(exportRes.headers.get('content-type')).toContain('text/csv');
    const csv = await exportRes.text();
    expect(csv).toContain('User Question');
    expect(csv).toContain('How do I export data?');
    expect(csv).toContain('Does OpenDocs support Kubernetes?');
  });

  test('tenant isolation: Org B cannot see or modify Org A gaps', async () => {
    // Org A setup
    const cookieA = await signIn(app, { id: 201, login: 'user-a', email: 'a@example.com' });
    const sessionA = await prisma.session.findFirstOrThrow({
      where: { activeOrganizationId: { not: null } },
      orderBy: { createdAt: 'desc' },
    });
    const orgAId = sessionA.activeOrganizationId!;

    await prisma.workspaceBilling.upsert({
      where: { organizationId: orgAId },
      update: { plan: 'pro' },
      create: { organizationId: orgAId, plan: 'pro' },
    });

    const gapA = await prisma.aiGap.create({
      data: {
        organizationId: orgAId,
        query: 'secret gap org a',
        count: 10,
        status: 'open',
      },
    });

    // Org B setup
    const cookieB = await signIn(app, { id: 202, login: 'user-b', email: 'b@example.com' });
    const sessionB = await prisma.session.findFirstOrThrow({
      where: { activeOrganizationId: { not: null }, userId: { not: sessionA.userId } },
      orderBy: { createdAt: 'desc' },
    });
    const orgBId = sessionB.activeOrganizationId!;

    await prisma.workspaceBilling.upsert({
      where: { organizationId: orgBId },
      update: { plan: 'pro' },
      create: { organizationId: orgBId, plan: 'pro' },
    });

    // Org B list gaps should not include Org A's gap
    const gapsBRes = await app.handle(
      new Request(`${BASE_URL}/api/v1/assistant/gaps`, {
        headers: { cookie: cookieB },
      }),
    );
    const gapsB = (await gapsBRes.json()) as { gaps: Array<{ id: string }> };
    expect(gapsB.gaps.some((g) => g.id === gapA.id)).toBe(false);

    // Org B attempting to dismiss Org A's gap gets 404
    const dismissRes = await app.handle(
      new Request(`${BASE_URL}/api/v1/assistant/gaps/${gapA.id}/dismiss`, {
        method: 'POST',
        headers: { cookie: cookieB },
      }),
    );
    expect(dismissRes.status).toBe(404);
  });
});
