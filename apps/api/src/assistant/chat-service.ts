import type { Prisma } from '../../generated/prisma/client';
import { getPrisma } from '../db';
import { ApiError } from '../errors';
import { capabilitiesFor, getPlan } from '../plan';
import { maskPii } from './pii';
import { parseJsonArray } from './validation';

export function normalizeGapQuery(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

export type PublicAssistantConfig = {
  enabled: boolean;
  name: string;
  button_label: string;
  welcome: string;
  suggested: string[];
  position: 'bottom-right' | 'bottom-left';
  show_sources: boolean;
  no_match_mode: 'contact' | 'email' | 'hide';
  contact_target: string;
};

export type ChatSource = {
  id: string;
  slug: string;
  title: string;
  step_range: string;
  start_step: number;
  end_step: number;
};

export type ProcessChatResult = {
  conversation_id: string;
  message_id: string;
  status: 'answered' | 'no_match' | 'out_of_credits';
  content: string;
  sources: ChatSource[];
  contact?: {
    mode: 'contact' | 'email' | 'hide';
    target: string;
  };
};

export const getPublicAssistantConfig = async (
  organizationId: string,
): Promise<PublicAssistantConfig> => {
  const prisma = getPrisma();
  const [assistant, plan] = await Promise.all([
    prisma.aiAssistant.findUnique({ where: { organizationId } }),
    getPlan(organizationId),
  ]);

  const planSupported = capabilitiesFor(plan).aiAssistant;

  if (!assistant) {
    return {
      enabled: false,
      name: 'AI Assistant',
      button_label: 'Ask AI',
      welcome: 'Hi! Ask me anything about our guides. I answer from our published guides and link the steps.',
      suggested: [],
      position: 'bottom-right',
      show_sources: true,
      no_match_mode: 'contact',
      contact_target: '',
    };
  }

  return {
    enabled: Boolean(assistant.enabled && planSupported),
    name: assistant.name || 'AI Assistant',
    button_label: assistant.buttonLabel || 'Ask AI',
    welcome:
      assistant.welcome ||
      'Hi! Ask me anything about our guides. I answer from our published guides and link the steps.',
    suggested: parseJsonArray(assistant.suggested),
    position: (assistant.position === 'bottom-left' ? 'bottom-left' : 'bottom-right'),
    show_sources: assistant.showSources,
    no_match_mode: (['contact', 'email', 'hide'].includes(assistant.noMatchMode)
      ? assistant.noMatchMode
      : 'contact') as 'contact' | 'email' | 'hide',
    contact_target: assistant.contactTarget || '',
  };
};

export const reserveCredits = async (
  organizationId: string,
  credits: number,
  modelId: string | null,
  messageId: string,
): Promise<{ ok: boolean; balanceAfter?: number; error?: string }> => {
  const prisma = getPrisma();

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;

    const latest = await tx.aiCreditLedger.findFirst({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });

    const currentBalance = latest?.balanceAfter ?? 0;
    if (currentBalance < credits) {
      return { ok: false, error: 'out_of_credits' };
    }

    const newBalance = currentBalance - credits;

    await tx.aiCreditLedger.create({
      data: {
        organizationId,
        delta: -credits,
        reason: 'reply_reservation',
        messageId,
        modelId: modelId ?? 'default',
        credits,
        balanceAfter: newBalance,
      },
    });

    return { ok: true, balanceAfter: newBalance };
  });
};

export const refundCredits = async (
  organizationId: string,
  credits: number,
  modelId: string | null,
  messageId: string,
): Promise<{ ok: boolean; balanceAfter: number }> => {
  const prisma = getPrisma();

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;

    const latest = await tx.aiCreditLedger.findFirst({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });

    const currentBalance = latest?.balanceAfter ?? 0;

    // Idempotent refund: a second refund for the same reservation id is a no-op
    const existingRefund = await tx.aiCreditLedger.findFirst({
      where: {
        organizationId,
        messageId,
        reason: 'reply_refund',
      },
    });
    if (existingRefund) {
      return { ok: true, balanceAfter: currentBalance };
    }

    const newBalance = currentBalance + credits;

    await tx.aiCreditLedger.create({
      data: {
        organizationId,
        delta: credits,
        reason: 'reply_refund',
        messageId,
        modelId: modelId ?? 'default',
        credits,
        balanceAfter: newBalance,
      },
    });

    return { ok: true, balanceAfter: newBalance };
  });
};

type GuideRetrievalResult = {
  flow: {
    id: string;
    slug: string;
    title: string;
    summary: string | null;
  };
  matchingSteps: {
    order: number;
    title: string | null;
    instruction: string;
  }[];
  startStep: number;
  endStep: number;
};

export const retrievePublishedGuides = async (
  organizationId: string,
  query: string,
  assistant: {
    sourceMode: string;
    sourceCategoryIds: unknown;
    excludedFlowIds: unknown;
  },
): Promise<GuideRetrievalResult[]> => {
  const prisma = getPrisma();
  const trimmed = query.trim().slice(0, 200);
  if (!trimmed) return [];

  const rawWords = trimmed
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1)
    .map((w) => w.toLowerCase());

  // Filter common English and Indonesian stopwords so meaningful terms are emphasized
  const stopwords = new Set([
    'how', 'to', 'do', 'i', 'the', 'a', 'an', 'in', 'on', 'at', 'for', 'of', 'and', 'or', 'is', 'are', 'what', 'where', 'can',
    'cara', 'bagaimana', 'di', 'ke', 'dari', 'pada', 'untuk', 'dan', 'atau', 'ini', 'itu', 'adalah', 'saya', 'bisa', 'buat',
  ]);

  const searchWords = rawWords.filter((w) => !stopwords.has(w));
  const terms = searchWords.length > 0 ? searchWords : rawWords;
  if (terms.length === 0) return [];

  const categoryIds = parseJsonArray(assistant.sourceCategoryIds);
  const excludedIds = parseJsonArray(assistant.excludedFlowIds);

  const baseWhere: Prisma.FlowWhereInput = {
    organizationId,
    deletedAt: null,
    visibility: 'published',
    latestRunId: { not: null },
    slug: { not: null },
  };

  if (assistant.sourceMode === 'categories' && categoryIds.length > 0) {
    baseWhere.categoryId = { in: categoryIds };
  }

  if (excludedIds.length > 0) {
    baseWhere.id = { notIn: excludedIds };
  }

  // Find candidate flows
  const candidateFlows = await prisma.flow.findMany({
    where: baseWhere,
    select: {
      id: true,
      slug: true,
      title: true,
      summary: true,
      latestRunId: true,
    },
    take: 50,
  });

  if (candidateFlows.length === 0) return [];

  const runIds = candidateFlows.map((f) => f.latestRunId!);
  const allSteps = await prisma.step.findMany({
    where: { runId: { in: runIds }, hidden: false },
    select: {
      runId: true,
      order: true,
      title: true,
      instruction: true,
    },
    orderBy: { order: 'asc' },
  });

  const stepsByRun = new Map<string, typeof allSteps>();
  for (const step of allSteps) {
    const list = stepsByRun.get(step.runId) ?? [];
    list.push(step);
    stepsByRun.set(step.runId, list);
  }

  const results: { score: number; result: GuideRetrievalResult }[] = [];

  for (const flow of candidateFlows) {
    const steps = stepsByRun.get(flow.latestRunId!) ?? [];
    let score = 0;
    const titleLower = flow.title.toLowerCase();
    const summaryLower = (flow.summary ?? '').toLowerCase();

    for (const term of terms) {
      if (titleLower.includes(term)) score += 5;
      if (summaryLower.includes(term)) score += 2;
    }

    const matchedStepOrders: number[] = [];

    for (const step of steps) {
      const stepText = `${step.title ?? ''} ${step.instruction}`.toLowerCase();
      let stepMatched = false;
      for (const term of terms) {
        if (stepText.includes(term)) {
          score += 3;
          stepMatched = true;
        }
      }
      if (stepMatched) {
        matchedStepOrders.push(step.order);
      }
    }

    if (score > 0 && steps.length > 0) {
      let startStep = 1;
      let endStep = steps.length;

      if (matchedStepOrders.length > 0) {
        startStep = Math.min(...matchedStepOrders);
        endStep = Math.max(...matchedStepOrders);
        // If single step matched and there are subsequent steps, give a focused range
        if (startStep === endStep && steps.length > startStep) {
          endStep = Math.min(steps.length, startStep + 3);
        }
      }

      const relevantSteps = steps.filter((s) => s.order >= startStep && s.order <= endStep);

      results.push({
        score,
        result: {
          flow: {
            id: flow.id,
            slug: flow.slug!,
            title: flow.title,
            summary: flow.summary,
          },
          matchingSteps: relevantSteps,
          startStep,
          endStep,
        },
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 3).map((r) => r.result);
};

export const processChat = async (
  organizationId: string,
  userMessage: string,
  visitorId: string,
  conversationId?: string,
): Promise<ProcessChatResult> => {
  const prisma = getPrisma();
  const trimmedMessage = userMessage.trim();
  if (!trimmedMessage) {
    throw new ApiError(422, 'validation_failed', 'Message cannot be empty');
  }
  if (trimmedMessage.length > 1000) {
    throw new ApiError(422, 'validation_failed', 'Message cannot exceed 1000 characters');
  }

  const [assistant, plan] = await Promise.all([
    prisma.aiAssistant.findUnique({ where: { organizationId } }),
    getPlan(organizationId),
  ]);

  if (!assistant || !assistant.enabled || !capabilitiesFor(plan).aiAssistant) {
    throw new ApiError(403, 'unauthorized', 'AI assistant is not enabled for this site');
  }

  // 1. Rate limiting checks
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const hourlyCount = await prisma.aiMessage.count({
    where: {
      role: 'user',
      createdAt: { gte: oneHourAgo },
      conversation: { organizationId, visitorId },
    },
  });

  if (hourlyCount >= assistant.hourlyPerVisitor) {
    throw new ApiError(429, 'quota_exceeded', 'Hourly question limit exceeded. Please try again later.');
  }

  // ponytail: count-then-insert, not atomic; cap can overshoot under concurrency
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const dailyCount = await prisma.aiMessage.count({
    where: {
      role: 'user',
      createdAt: { gte: startOfDay },
      conversation: { organizationId },
    },
  });

  if (dailyCount >= assistant.dailyCap) {
    throw new ApiError(429, 'quota_exceeded', 'Daily question cap reached for this site.');
  }

  // 2. Credits check and reservation
  let creditsRequired = 1;
  if (assistant.modelId) {
    const aiModel = await prisma.aiModel.findFirst({
      where: { modelId: assistant.modelId, status: 'active' },
    });
    if (aiModel) {
      creditsRequired = aiModel.creditsPerReply;
    }
  }

  const reservationMessageId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const reservation = await reserveCredits(
    organizationId,
    creditsRequired,
    assistant.modelId,
    reservationMessageId,
  );

  if (!reservation.ok) {
    return {
      conversation_id: conversationId || '',
      message_id: '',
      status: 'out_of_credits',
      content: 'The AI assistant is temporarily out of credits. You can contact support for assistance.',
      sources: [],
      contact: {
        mode: (assistant.noMatchMode as 'contact' | 'email' | 'hide') || 'contact',
        target: assistant.contactTarget || '',
      },
    };
  }

  let answerStored = false;
  let botMessageId = '';
  let finalStatus: 'answered' | 'no_match' = 'answered';
  let finalContent = '';
  let finalSources: ChatSource[] = [];
  let conversationObjId = '';

  try {
    // 3. Retrieval over published guides
    const retrieved = await retrievePublishedGuides(organizationId, trimmedMessage, assistant);

    let conversation = conversationId
      ? await prisma.aiConversation.findFirst({
          where: { id: conversationId, organizationId, visitorId },
        })
      : null;

    if (!conversation) {
      conversation = await prisma.aiConversation.create({
        data: {
          organizationId,
          visitorId,
        },
      });
    } else {
      await prisma.aiConversation.update({
        where: { id: conversation.id },
        data: { updatedAt: new Date() },
      });
    }

    conversationObjId = conversation.id;

    // PII masking if configured
    const userContentToSave = assistant.maskPii ? maskPii(trimmedMessage) : trimmedMessage;

    await prisma.aiMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'user',
        content: userContentToSave,
        answered: true,
      },
    });

    // Check if off-topic or no guides matched
    if (retrieved.length === 0) {
      const noMatchContent = 'I could not find this in our guides. You can ask our team directly.';
      const botContentToSave = assistant.maskPii ? maskPii(noMatchContent) : noMatchContent;

      const botMessage = await prisma.aiMessage.create({
        data: {
          conversationId: conversation.id,
          role: 'assistant',
          content: botContentToSave,
          citedFlowIds: [],
          answered: false,
          modelId: assistant.modelId ?? 'default',
          tokensUsed: 15,
        },
      });

      const normalized = normalizeGapQuery(userContentToSave);
      if (normalized.length > 0) {
        try {
          await prisma.aiGap.upsert({
            where: {
              organizationId_query: {
                organizationId,
                query: normalized,
              },
            },
            update: {
              count: { increment: 1 },
              lastSeenAt: new Date(),
            },
            create: {
              organizationId,
              query: normalized,
              count: 1,
              status: 'open',
              lastSeenAt: new Date(),
            },
          });
        } catch {
          // Gap upsert non-critical failure should not fail chat message
        }
      }

      answerStored = true;
      botMessageId = botMessage.id;
      finalStatus = 'no_match';
      finalContent = noMatchContent;
      finalSources = [];
    } else {
      // 4. Generate answer from retrieved guide steps
      const primary = retrieved[0];
      const sources: ChatSource[] = retrieved.map((r) => {
        const stepRange =
          r.startStep === r.endStep
            ? `step ${r.startStep}`
            : `steps ${r.startStep} to ${r.endStep}`;
        return {
          id: r.flow.id,
          slug: r.flow.slug,
          title: r.flow.title,
          step_range: stepRange,
          start_step: r.startStep,
          end_step: r.endStep,
        };
      });

      const stepBulletPoints = primary.matchingSteps
        .slice(0, 5)
        .map((s) => `${s.order}. ${s.instruction}`)
        .join('\n');

      let answerText = `To ${primary.flow.title.toLowerCase().startsWith('how') ? primary.flow.title : `${primary.flow.title}`}:\n\n${stepBulletPoints}`;
      if (primary.flow.summary && !answerText.includes(primary.flow.summary)) {
        answerText = `${primary.flow.summary}\n\n${answerText}`;
      }

      const botContentToSave = assistant.maskPii ? maskPii(answerText) : answerText;

      const botMessage = await prisma.aiMessage.create({
        data: {
          conversationId: conversation.id,
          role: 'assistant',
          content: botContentToSave,
          citedFlowIds: sources.map((s) => s.id),
          answered: true,
          modelId: assistant.modelId ?? 'default',
          tokensUsed: Math.ceil(answerText.length / 4),
        },
      });

      answerStored = true;
      botMessageId = botMessage.id;
      finalStatus = 'answered';
      finalContent = answerText;
      finalSources = sources;
    }
  } catch (err) {
    // If an error occurred during generation before answer was stored, refund the reserved credits!
    if (!answerStored) {
      await refundCredits(
        organizationId,
        creditsRequired,
        assistant.modelId,
        reservationMessageId,
      ).catch(() => {});
    }
    throw err;
  }

  // Cleanup retention separately from reply generation so errors cannot trigger a refund
  if (assistant.retentionDays > 0) {
    try {
      const retentionCutoff = new Date(Date.now() - assistant.retentionDays * 86400000);
      await prisma.aiConversation.deleteMany({
        where: { organizationId, updatedAt: { lt: retentionCutoff } },
      });
    } catch {
      // retention cleanup errors do not fail the chat response
    }
  }

  return {
    conversation_id: conversationObjId,
    message_id: botMessageId,
    status: finalStatus,
    content: finalContent,
    sources: finalSources,
    contact: {
      mode: (assistant.noMatchMode as 'contact' | 'email' | 'hide') || 'contact',
      target: assistant.contactTarget || '',
    },
  };
};

export const voteChatMessage = async (
  organizationId: string,
  messageId: string,
  visitorKey: string,
  helpful: boolean,
  feedback?: string,
): Promise<{ ok: boolean }> => {
  if (feedback !== undefined && feedback.length > 500) {
    throw new ApiError(422, 'validation_failed', 'Feedback cannot exceed 500 characters');
  }

  const prisma = getPrisma();

  const message = await prisma.aiMessage.findFirst({
    where: {
      id: messageId,
      conversation: { organizationId },
    },
    include: {
      conversation: true,
    },
  });

  if (!message || message.conversation.visitorId !== visitorKey) {
    throw new ApiError(404, 'not_found', 'Message not found');
  }

  if (message.rating !== null) {
    throw new ApiError(409, 'validation_failed', 'Message has already been rated');
  }

  const assistant = await prisma.aiAssistant.findUnique({
    where: { organizationId },
    select: { maskPii: true },
  });

  const rating = helpful ? 'helpful' : 'unhelpful';
  const maskedFeedback = feedback && assistant?.maskPii ? maskPii(feedback) : feedback;

  await prisma.aiMessage.update({
    where: { id: messageId },
    data: {
      rating,
      feedback: maskedFeedback,
    },
  });

  return { ok: true };
};
