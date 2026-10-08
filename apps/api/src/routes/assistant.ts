import { Elysia } from 'elysia';
import type { Prisma } from '../../generated/prisma/client';
import { ApiError } from '../errors';
import { getPrisma } from '../db';
import { capabilitiesFor, getPlan } from '../plan';
import { normalizeRole } from '../site/role';
import { requireMember, requireSession } from '../site/session';
import { decryptAiSecret, encryptAiSecret } from '../platform/ai-secret';
import { testProviderKey } from '../platform/ai-models';
import { recordAuditLog } from '../audit/audit-log';
import {
  isValidContactTarget,
  parseJsonArray,
  sanitizeAssistant,
  validateSsrfUrl,
} from '../assistant/validation';

export { isValidContactTarget, sanitizeAssistant, validateSsrfUrl };

export function escapeCsv(val: unknown): string {
  if (val === null || val === undefined) return '';
  // Visitor text lands in a spreadsheet: neutralise formulas (CSV injection).
  const raw = String(val);
  const str = /^[=+\-@\t\r]/.test(raw) ? "'" + raw : raw;
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

const requireAssistantAccess = async (request: Request) => {
  const { userId, organizationId } = await requireSession(request);
  const member = await requireMember(userId, organizationId);
  const role = normalizeRole(member.role);
  if (role !== 'owner' && role !== 'admin') {
    throw new ApiError(403, 'unauthorized', 'Only the owner or an admin can access AI assistant');
  }

  const plan = await getPlan(organizationId);
  if (!capabilitiesFor(plan).aiAssistant) {
    throw new ApiError(403, 'unauthorized', 'The AI assistant is available on Pro and Enterprise plans');
  }

  return { userId, organizationId, plan, role };
};

const readJsonBody = async (request: Request): Promise<Record<string, unknown>> => {
  const text = await request.text().catch(() => {
    throw new ApiError(422, 'validation_failed', 'A JSON request body is required');
  });
  let parsed: unknown = {};
  if (text.trim().length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ApiError(422, 'validation_failed', 'Request body must be valid JSON');
    }
  }
  return (parsed as Record<string, unknown>) ?? {};
};

export const assistantRoute = new Elysia()
  .get('/api/v1/assistant', async ({ request }) => {
    const { userId, organizationId } = await requireSession(request);
    const member = await requireMember(userId, organizationId);
    const role = normalizeRole(member.role);
    if (role !== 'owner' && role !== 'admin') {
      throw new ApiError(403, 'unauthorized', 'Only the owner or an admin can view AI assistant settings');
    }

    const plan = await getPlan(organizationId);
    if (!capabilitiesFor(plan).aiAssistant) {
      throw new ApiError(403, 'unauthorized', 'The AI assistant is available on Pro and Enterprise plans');
    }

    const prisma = getPrisma();

    // 1. Get or build default assistant row
    let assistant = await prisma.aiAssistant.findUnique({
      where: { organizationId },
    });

    if (!assistant) {
      assistant = {
        organizationId,
        enabled: false,
        name: 'AI Assistant',
        buttonLabel: 'Ask AI',
        welcome: 'How can I help you today?',
        suggested: [],
        tone: 'friendly',
        language: 'auto',
        sourceMode: 'all',
        sourceCategoryIds: [],
        excludedFlowIds: [],
        noMatchMode: 'contact',
        contactTarget: '',
        offTopicRefusal: true,
        showSources: true,
        hourlyPerVisitor: 30,
        dailyCap: 500,
        retentionDays: 30,
        maskPii: true,
        position: 'bottom-right',
        modelId: null,
        byoEnabled: false,
        byoProvider: 'anthropic',
        byoBaseUrl: null,
        byoModel: null,
        byoSecret: null,
        byoFallbackCredits: false,
        embedOrigins: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }

    // 2. Credits info
    const planConfig = await prisma.planConfig.findUnique({
      where: { plan },
    });
    const defaultCredits = plan === 'enterprise' ? 10000 : plan === 'pro' ? 1000 : 0;
    const monthlyCredits = planConfig?.monthlyCredits ?? defaultCredits;

    const startOfMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    const ledgerAggr = await prisma.aiCreditLedger.aggregate({
      where: {
        organizationId,
        createdAt: { gte: startOfMonth },
        delta: { lt: 0 },
      },
      _sum: { delta: true },
    });
    const usedCredits = Math.abs(ledgerAggr._sum.delta ?? 0);

    const nextMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1));
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const resetDateStr = `${monthNames[nextMonth.getUTCMonth()]} 1`;

    const credits = {
      used: usedCredits,
      total: monthlyCredits,
      percent: monthlyCredits > 0 ? Math.min(100, Math.round((usedCredits / monthlyCredits) * 100)) : 0,
      reset_date: resetDateStr,
    };

    // 3. Catalog models for this plan
    const allModels = await prisma.aiModel.findMany({
      where: { status: 'active' },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });

    const planModels = allModels.filter((m) => {
      const plans = parseJsonArray(m.plans);
      return plans.length === 0 || plans.includes(plan);
    });

    const models = (
      planModels.length > 0
        ? planModels
        : [
            {
              id: 'default-standard',
              modelId: 'gpt-4o-mini',
              name: 'GPT-4o Mini',
              provider: 'openai',
              label: 'Standard',
              creditsPerReply: 1,
              isDefault: true,
            },
            {
              id: 'default-advanced',
              modelId: 'claude-3-5-sonnet',
              name: 'Claude 3.5 Sonnet',
              provider: 'anthropic',
              label: 'Advanced',
              creditsPerReply: 5,
              isDefault: false,
            },
          ]
    ).map((m) => ({
      id: m.id,
      model_id: m.modelId,
      name: m.name,
      provider: m.provider,
      label: m.label,
      credits_per_reply: m.creditsPerReply,
      is_default: m.isDefault,
    }));

    // 4. Replies by model last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const messages = await prisma.aiMessage.findMany({
      where: {
        createdAt: { gte: thirtyDaysAgo },
        conversation: { organizationId },
        role: 'assistant',
      },
      select: { modelId: true },
    });

    const countsByModel: Record<string, number> = {};
    for (const msg of messages) {
      const mid = msg.modelId || 'default';
      countsByModel[mid] = (countsByModel[mid] ?? 0) + 1;
    }

    const repliesByModel = Object.entries(countsByModel).map(([mid, count]) => {
      const foundModel = models.find((m) => m.model_id === mid);
      return {
        model_id: mid,
        model_name: foundModel?.name ?? mid,
        replies_count: count,
        credits_used: count * (foundModel?.credits_per_reply ?? 1),
      };
    });

    // 5. Index status
    const publishedGuidesCount = await prisma.flow.count({
      where: {
        organizationId,
        deletedAt: null,
        latestRunId: { not: null },
      },
    });

    const indexStatus = {
      indexed_count: publishedGuidesCount,
      total_count: publishedGuidesCount,
      last_indexed_at: assistant.updatedAt.toISOString(),
    };

    return {
      assistant: sanitizeAssistant(assistant),
      credits,
      models,
      replies_by_model: repliesByModel,
      index_status: indexStatus,
    };
  })
  .patch('/api/v1/assistant', async ({ request }) => {
    const { userId, organizationId } = await requireSession(request);
    const member = await requireMember(userId, organizationId);
    const role = normalizeRole(member.role);
    if (role !== 'owner' && role !== 'admin') {
      throw new ApiError(403, 'unauthorized', 'Only the owner or an admin can manage the AI assistant');
    }

    const plan = await getPlan(organizationId);
    if (!capabilitiesFor(plan).aiAssistant) {
      throw new ApiError(403, 'unauthorized', 'The AI assistant is available on Pro and Enterprise plans');
    }

    const body = await readJsonBody(request);
    const data: Record<string, unknown> = {};

    if (body.enabled !== undefined) data.enabled = Boolean(body.enabled);
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) throw new ApiError(422, 'validation_failed', 'Name cannot be empty');
      data.name = name;
    }
    if (body.button_label !== undefined || body.buttonLabel !== undefined) {
      const label = String(body.button_label ?? body.buttonLabel).trim();
      if (!label) throw new ApiError(422, 'validation_failed', 'Button label cannot be empty');
      data.buttonLabel = label;
    }
    if (body.welcome !== undefined) {
      data.welcome = String(body.welcome).trim();
    }
    if (body.suggested !== undefined) {
      if (!Array.isArray(body.suggested)) {
        throw new ApiError(422, 'validation_failed', 'Suggested questions must be an array');
      }
      if (body.suggested.length > 4) {
        throw new ApiError(422, 'validation_failed', 'Suggested questions cannot exceed 4');
      }
      data.suggested = body.suggested.map((q) => String(q).trim()).filter(Boolean);
    }
    if (body.tone !== undefined) {
      const tone = String(body.tone);
      if (!['friendly', 'concise', 'formal'].includes(tone)) {
        throw new ApiError(422, 'validation_failed', 'Tone must be friendly, concise, or formal');
      }
      data.tone = tone;
    }
    if (body.language !== undefined) {
      data.language = String(body.language);
    }
    if (body.source_mode !== undefined || body.sourceMode !== undefined) {
      const sm = String(body.source_mode ?? body.sourceMode);
      if (!['all', 'categories'].includes(sm)) {
        throw new ApiError(422, 'validation_failed', 'source_mode must be all or categories');
      }
      data.sourceMode = sm;
    }
    if (body.source_category_ids !== undefined || body.sourceCategoryIds !== undefined) {
      const catIds = body.source_category_ids ?? body.sourceCategoryIds;
      if (!Array.isArray(catIds)) throw new ApiError(422, 'validation_failed', 'source_category_ids must be an array');
      data.sourceCategoryIds = catIds.map(String);
    }
    if (body.excluded_flow_ids !== undefined || body.excludedFlowIds !== undefined) {
      const flowIds = body.excluded_flow_ids ?? body.excludedFlowIds;
      if (!Array.isArray(flowIds)) throw new ApiError(422, 'validation_failed', 'excluded_flow_ids must be an array');
      data.excludedFlowIds = flowIds.map(String);
    }
    if (body.no_match_mode !== undefined || body.noMatchMode !== undefined) {
      const nmm = String(body.no_match_mode ?? body.noMatchMode);
      if (!['contact', 'email', 'hide'].includes(nmm)) {
        throw new ApiError(422, 'validation_failed', 'no_match_mode must be contact, email, or hide');
      }
      data.noMatchMode = nmm;
    }
    if (body.contact_target !== undefined || body.contactTarget !== undefined) {
      const rawTarget = String(body.contact_target ?? body.contactTarget).trim();
      if (!isValidContactTarget(rawTarget)) {
        throw new ApiError(422, 'validation_failed', 'contact_target must be an email address or an http(s) URL');
      }
      data.contactTarget = rawTarget;
    }
    if (body.off_topic_refusal !== undefined || body.offTopicRefusal !== undefined) {
      data.offTopicRefusal = Boolean(body.off_topic_refusal ?? body.offTopicRefusal);
    }
    if (body.show_sources !== undefined || body.showSources !== undefined) {
      data.showSources = Boolean(body.show_sources ?? body.showSources);
    }
    if (body.hourly_per_visitor !== undefined || body.hourlyPerVisitor !== undefined) {
      data.hourlyPerVisitor = Number(body.hourly_per_visitor ?? body.hourlyPerVisitor);
    }
    if (body.daily_cap !== undefined || body.dailyCap !== undefined) {
      data.dailyCap = Number(body.daily_cap ?? body.dailyCap);
    }
    if (body.retention_days !== undefined || body.retentionDays !== undefined) {
      data.retentionDays = Number(body.retention_days ?? body.retentionDays);
    }
    if (body.mask_pii !== undefined || body.maskPii !== undefined) {
      data.maskPii = Boolean(body.mask_pii ?? body.maskPii);
    }
    if (body.position !== undefined) {
      const pos = String(body.position);
      if (!['bottom-right', 'bottom-left'].includes(pos)) {
        throw new ApiError(422, 'validation_failed', 'position must be bottom-right or bottom-left');
      }
      data.position = pos;
    }
    if (body.model_id !== undefined || body.modelId !== undefined) {
      data.modelId = (body.model_id ?? body.modelId) ? String(body.model_id ?? body.modelId) : null;
    }

    // Enterprise-only BYOK and Embed features
    const embedOriginsAttempt = body.embed_origins ?? body.embedOrigins;
    const hasByoAttempt =
      Boolean(body.byo_enabled ?? body.byoEnabled) ||
      body.byo_secret !== undefined ||
      body.byoSecret !== undefined ||
      (Array.isArray(embedOriginsAttempt) && embedOriginsAttempt.length > 0);

    if (hasByoAttempt && plan !== 'enterprise') {
      throw new ApiError(403, 'unauthorized', 'Custom provider and site embedding require an Enterprise plan');
    }

    if (body.byo_enabled !== undefined || body.byoEnabled !== undefined) {
      data.byoEnabled = Boolean(body.byo_enabled ?? body.byoEnabled);
    }
    if (body.byo_provider !== undefined || body.byoProvider !== undefined) {
      data.byoProvider = String(body.byo_provider ?? body.byoProvider);
    }
    if (body.byo_model !== undefined || body.byoModel !== undefined) {
      data.byoModel = String(body.byo_model ?? body.byoModel);
    }
    if (body.byo_base_url !== undefined || body.byoBaseUrl !== undefined) {
      const rawUrl = String(body.byo_base_url ?? body.byoBaseUrl).trim();
      if (rawUrl) {
        const ssrf = validateSsrfUrl(rawUrl);
        if (!ssrf.ok) {
          throw new ApiError(422, 'validation_failed', ssrf.error ?? 'Private addresses are refused');
        }
        data.byoBaseUrl = rawUrl;
      } else {
        data.byoBaseUrl = null;
      }
    }
    if (body.byo_secret !== undefined || body.byoSecret !== undefined) {
      const secret = String(body.byo_secret ?? body.byoSecret).trim();
      if (secret) {
        data.byoSecret = encryptAiSecret(secret);
      } else {
        data.byoSecret = null;
      }
    }
    if (body.byo_fallback_credits !== undefined || body.byoFallbackCredits !== undefined) {
      data.byoFallbackCredits = Boolean(body.byo_fallback_credits ?? body.byoFallbackCredits);
    }
    if (body.embed_origins !== undefined || body.embedOrigins !== undefined) {
      const origins = body.embed_origins ?? body.embedOrigins;
      if (!Array.isArray(origins)) throw new ApiError(422, 'validation_failed', 'embed_origins must be an array');
      data.embedOrigins = origins.map(String);
    }

    const prisma = getPrisma();
    const updated = await prisma.aiAssistant.upsert({
      where: { organizationId },
      update: data,
      create: {
        organizationId,
        ...data,
      },
    });

    await recordAuditLog({
      actorKind: 'user',
      actorId: userId,
      organizationId,
      action: 'Updated AI assistant settings',
      detail: { type: 'assistant' },
    });

    return { assistant: sanitizeAssistant(updated) };
  })
  .post('/api/v1/assistant/reindex', async ({ request }) => {
    const { userId, organizationId } = await requireSession(request);
    const member = await requireMember(userId, organizationId);
    const role = normalizeRole(member.role);
    if (role !== 'owner' && role !== 'admin') {
      throw new ApiError(403, 'unauthorized', 'Only the owner or an admin can manage the AI assistant');
    }

    const plan = await getPlan(organizationId);
    if (!capabilitiesFor(plan).aiAssistant) {
      throw new ApiError(403, 'unauthorized', 'The AI assistant is available on Pro and Enterprise plans');
    }

    const prisma = getPrisma();
    const count = await prisma.flow.count({
      where: { organizationId, deletedAt: null, latestRunId: { not: null } },
    });

    await prisma.aiAssistant.upsert({
      where: { organizationId },
      update: { updatedAt: new Date() },
      create: { organizationId, updatedAt: new Date() },
    });

    await recordAuditLog({
      actorKind: 'user',
      actorId: userId,
      organizationId,
      action: 'Reindexed guides for AI assistant',
      detail: { type: 'assistant', indexedCount: count },
    });

    return { ok: true, indexed_count: count, reindexed_at: new Date().toISOString() };
  })
  .post('/api/v1/assistant/test-connection', async ({ request }) => {
    const { userId, organizationId } = await requireSession(request);
    const member = await requireMember(userId, organizationId);
    const role = normalizeRole(member.role);
    if (role !== 'owner' && role !== 'admin') {
      throw new ApiError(403, 'unauthorized', 'Only the owner or an admin can manage the AI assistant');
    }

    const plan = await getPlan(organizationId);
    if (plan !== 'enterprise') {
      throw new ApiError(403, 'unauthorized', 'Custom provider testing requires an Enterprise plan');
    }

    const body = await readJsonBody(request);
    const provider = String(body.provider || 'anthropic');
    const baseUrl = (body.base_url as string) || (body.baseUrl as string) || null;
    let secret = (body.api_key as string) || (body.apiKey as string) || (body.secret as string) || null;

    if (baseUrl) {
      const ssrf = validateSsrfUrl(baseUrl);
      if (!ssrf.ok) {
        throw new ApiError(422, 'validation_failed', ssrf.error ?? 'Private addresses are refused');
      }
    }

    const prisma = getPrisma();
    if (!secret) {
      const current = await prisma.aiAssistant.findUnique({ where: { organizationId } });
      if (current?.byoSecret) {
        try {
          secret = decryptAiSecret(current.byoSecret);
        } catch {
          throw new ApiError(422, 'validation_failed', 'Could not decrypt stored API key');
        }
      }
    }

    if (!secret || secret.trim().length === 0) {
      throw new ApiError(422, 'validation_failed', 'API key cannot be empty');
    }

    return await testProviderKey(provider, secret, baseUrl);
  })
  .get('/api/v1/assistant/stats', async ({ request }) => {
    const { organizationId } = await requireAssistantAccess(request);
    const url = new URL(request.url);
    const rawDays = parseInt(url.searchParams.get('days') || '30', 10);
    const days = Number.isFinite(rawDays) && rawDays > 0 ? rawDays : 30;
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const prisma = getPrisma();

    const questions = await prisma.aiMessage.count({
      where: {
        role: 'user',
        conversation: { organizationId },
        createdAt: { gte: startDate },
      },
    });

    const totalAssistantReplies = await prisma.aiMessage.count({
      where: {
        role: 'assistant',
        conversation: { organizationId },
        createdAt: { gte: startDate },
      },
    });
    const answeredCount = await prisma.aiMessage.count({
      where: {
        role: 'assistant',
        answered: true,
        conversation: { organizationId },
        createdAt: { gte: startDate },
      },
    });
    const answeredPercent =
      totalAssistantReplies > 0 ? Math.round((answeredCount / totalAssistantReplies) * 100) : 0;

    const ratedCount = await prisma.aiMessage.count({
      where: {
        conversation: { organizationId },
        createdAt: { gte: startDate },
        rating: { not: null },
      },
    });
    const helpfulCount = await prisma.aiMessage.count({
      where: {
        conversation: { organizationId },
        createdAt: { gte: startDate },
        rating: 'helpful',
      },
    });
    const helpfulPercent = ratedCount > 0 ? Math.round((helpfulCount / ratedCount) * 100) : 0;

    const contentGaps = await prisma.aiGap.count({
      where: {
        organizationId,
        status: 'open',
      },
    });

    const ledgerAggr = await prisma.aiCreditLedger.aggregate({
      where: {
        organizationId,
        createdAt: { gte: startDate },
        delta: { lt: 0 },
      },
      _sum: { delta: true },
    });
    const creditsUsed = Math.abs(ledgerAggr._sum.delta ?? 0);

    return {
      days,
      questions,
      answered_percent: answeredPercent,
      helpful_percent: helpfulPercent,
      content_gaps: contentGaps,
      credits_used: creditsUsed,
    };
  })
  .get('/api/v1/assistant/gaps', async ({ request }) => {
    const { organizationId } = await requireAssistantAccess(request);
    const url = new URL(request.url);
    const statusParam = url.searchParams.get('status') || 'open';
    const prisma = getPrisma();

    const where: Prisma.AiGapWhereInput = { organizationId };
    if (statusParam !== 'all') {
      where.status = statusParam;
    }

    const gaps = await prisma.aiGap.findMany({
      where,
      orderBy: [{ count: 'desc' }, { lastSeenAt: 'desc' }],
    });

    const flowIds = gaps.map((g) => g.flowId).filter((id): id is string => Boolean(id));
    const flows =
      flowIds.length > 0
        ? await prisma.flow.findMany({
            where: { id: { in: flowIds }, organizationId },
            select: { id: true, title: true, slug: true },
          })
        : [];
    const flowMap = new Map(flows.map((f) => [f.id, f]));

    return {
      gaps: gaps.map((g) => ({
        id: g.id,
        query: g.query,
        count: g.count,
        status: g.status,
        flow_id: g.flowId,
        flow: g.flowId ? flowMap.get(g.flowId) ?? null : null,
        last_seen_at: g.lastSeenAt.toISOString(),
        created_at: g.createdAt.toISOString(),
      })),
    };
  })
  .patch('/api/v1/assistant/gaps/:id', async ({ request, params }) => {
    const { organizationId } = await requireAssistantAccess(request);
    const prisma = getPrisma();
    const gap = await prisma.aiGap.findFirst({
      where: { id: params.id, organizationId },
    });
    if (!gap) {
      throw new ApiError(404, 'not_found', 'Content gap not found');
    }

    const body = await readJsonBody(request);
    const updateData: { status?: string; flowId?: string | null } = {};

    if (body.status !== undefined) {
      const status = String(body.status);
      if (!['open', 'recorded', 'dismissed'].includes(status)) {
        throw new ApiError(422, 'validation_failed', 'status must be open, recorded, or dismissed');
      }
      updateData.status = status;
    }

    if (body.flow_id !== undefined || body.flowId !== undefined) {
      const flowId = (body.flow_id ?? body.flowId) ? String(body.flow_id ?? body.flowId) : null;
      if (flowId) {
        const flow = await prisma.flow.findFirst({
          where: {
            OR: [{ id: flowId }, { publicId: flowId }],
            organizationId,
          },
        });
        if (!flow) {
          throw new ApiError(404, 'not_found', 'Guide not found');
        }
        updateData.flowId = flow.id;
        if (updateData.status === undefined) {
          updateData.status = 'recorded';
        }
      } else {
        updateData.flowId = null;
      }
    }

    const updated = await prisma.aiGap.update({
      where: { id: gap.id },
      data: updateData,
    });

    return { gap: updated };
  })
  .post('/api/v1/assistant/gaps/:id/dismiss', async ({ request, params }) => {
    const { organizationId } = await requireAssistantAccess(request);
    const prisma = getPrisma();
    const gap = await prisma.aiGap.findFirst({
      where: { id: params.id, organizationId },
    });
    if (!gap) {
      throw new ApiError(404, 'not_found', 'Content gap not found');
    }
    const updated = await prisma.aiGap.update({
      where: { id: gap.id },
      data: { status: 'dismissed' },
    });
    return { ok: true, gap: updated };
  })
  .post('/api/v1/assistant/gaps/:id/attach', async ({ request, params }) => {
    const { organizationId } = await requireAssistantAccess(request);
    const prisma = getPrisma();
    const gap = await prisma.aiGap.findFirst({
      where: { id: params.id, organizationId },
    });
    if (!gap) {
      throw new ApiError(404, 'not_found', 'Content gap not found');
    }
    const body = await readJsonBody(request);
    const flowId = String(body.flow_id ?? body.flowId ?? '').trim();
    if (!flowId) {
      throw new ApiError(422, 'validation_failed', 'flow_id is required');
    }
    const flow = await prisma.flow.findFirst({
      where: {
        OR: [{ id: flowId }, { publicId: flowId }],
        organizationId,
      },
    });
    if (!flow) {
      throw new ApiError(404, 'not_found', 'Guide not found');
    }
    const updated = await prisma.aiGap.update({
      where: { id: gap.id },
      data: { flowId: flow.id, status: 'recorded' },
    });
    return { ok: true, gap: updated };
  })
  .get('/api/v1/assistant/conversations', async ({ request }) => {
    const { organizationId } = await requireAssistantAccess(request);
    const url = new URL(request.url);
    const rawDays = parseInt(url.searchParams.get('days') || '30', 10);
    const days = Number.isFinite(rawDays) && rawDays > 0 ? rawDays : 30;
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const prisma = getPrisma();

    const conversations = await prisma.aiConversation.findMany({
      where: {
        organizationId,
        updatedAt: { gte: startDate },
      },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });

    const items = conversations.map((c) => {
      const userMsg = c.messages.find((m) => m.role === 'user');
      const assistantMsg = c.messages.find((m) => m.role === 'assistant');
      const helpfulMsg = c.messages.find((m) => m.rating);
      return {
        id: c.id,
        visitor_id: c.visitorId,
        created_at: c.createdAt.toISOString(),
        updated_at: c.updatedAt.toISOString(),
        question: userMsg?.content ?? '',
        answered: assistantMsg ? assistantMsg.answered : false,
        rating: helpfulMsg?.rating ?? null,
        messages: c.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          answered: m.answered,
          rating: m.rating,
          feedback: m.feedback,
          cited_flow_ids: parseJsonArray(m.citedFlowIds),
          model_id: m.modelId,
          tokens_used: m.tokensUsed,
          created_at: m.createdAt.toISOString(),
        })),
      };
    });

    return { conversations: items };
  })
  .get('/api/v1/assistant/conversations/:id', async ({ request, params }) => {
    const { organizationId } = await requireAssistantAccess(request);
    const prisma = getPrisma();
    const conversation = await prisma.aiConversation.findFirst({
      where: { id: params.id, organizationId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!conversation) {
      throw new ApiError(404, 'not_found', 'Conversation not found');
    }
    return {
      conversation: {
        id: conversation.id,
        visitor_id: conversation.visitorId,
        created_at: conversation.createdAt.toISOString(),
        updated_at: conversation.updatedAt.toISOString(),
        messages: conversation.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          answered: m.answered,
          rating: m.rating,
          feedback: m.feedback,
          cited_flow_ids: parseJsonArray(m.citedFlowIds),
          model_id: m.modelId,
          tokens_used: m.tokensUsed,
          created_at: m.createdAt.toISOString(),
        })),
      },
    };
  })
  .get('/api/v1/assistant/export', async ({ request }) => {
    const { organizationId } = await requireAssistantAccess(request);
    const url = new URL(request.url);
    const rawDays = parseInt(url.searchParams.get('days') || '30', 10);
    const days = Number.isFinite(rawDays) && rawDays > 0 ? rawDays : 30;
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const prisma = getPrisma();

    const conversations = await prisma.aiConversation.findMany({
      where: {
        organizationId,
        updatedAt: { gte: startDate },
      },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const rows: string[] = [
      ['Date', 'Conversation ID', 'Visitor ID', 'User Question', 'Answered', 'Rating', 'Feedback', 'Tokens Used', 'Model'].join(','),
    ];

    for (const conv of conversations) {
      const userMsg = conv.messages.find((m) => m.role === 'user');
      const assistantMsg = conv.messages.find((m) => m.role === 'assistant');
      const row = [
        escapeCsv(conv.createdAt.toISOString()),
        escapeCsv(conv.id),
        escapeCsv(conv.visitorId),
        escapeCsv(userMsg?.content ?? ''),
        escapeCsv(assistantMsg ? (assistantMsg.answered ? 'Yes' : 'No') : ''),
        escapeCsv(assistantMsg?.rating ?? ''),
        escapeCsv(assistantMsg?.feedback ?? ''),
        escapeCsv(assistantMsg?.tokensUsed ?? 0),
        escapeCsv(assistantMsg?.modelId ?? ''),
      ];
      rows.push(row.join(','));
    }

    const csv = rows.join('\r\n');
    return new Response(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="assistant-conversations-${days}d.csv"`,
      },
    });
  });
