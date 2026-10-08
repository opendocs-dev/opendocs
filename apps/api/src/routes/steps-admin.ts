import { Elysia } from 'elysia';
import { Prisma } from '../../generated/prisma/client';
import { auth } from '../auth';
import { getPrisma } from '../db';
import { ApiError } from '../errors';
import { roleFor } from '../site/role';
import { refreshSearchDocument } from '../site/search-doc';
import { imageFor } from './docs';
import { getInstanceOrg } from '../instance-org';

const unauthorized = (message: string) => new ApiError(403, 'unauthorized', message);
const invalid = (message: string) => new ApiError(422, 'validation_failed', message);
const notFound = (message = 'Not found') => new ApiError(404, 'not_found', message);

const requireSessionAndMember = async (request: Request) => {
  const session = await auth.api.getSession({ headers: request.headers });
  const organizationId = session ? (await getInstanceOrg()).id : undefined;
  if (!session || !organizationId) {
    throw new ApiError(401, 'unauthorized', 'A valid session is required');
  }
  const role = await roleFor(session.user.id, organizationId);
  if (!role) {
    throw unauthorized('You are not a member of this workspace');
  }
  return { userId: session.user.id, organizationId, role };
};

const readJsonBody = async (request: Request): Promise<Record<string, unknown>> => {
  const text = await request.text().catch(() => {
    throw invalid('A JSON request body is required');
  });

  let parsed: unknown = {};
  if (text.trim().length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw invalid('Malformed JSON request body');
    }
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw invalid('Request body must be a JSON object');
  }

  return parsed as Record<string, unknown>;
};

const resolveFlowWithLatestRun = async (publicId: string, organizationId: string) => {
  const prisma = getPrisma();
  const flow = await prisma.flow.findFirst({
    where: { publicId, organizationId, deletedAt: null },
    select: { id: true, publicId: true, latestRunId: true },
  });
  if (!flow) {
    throw notFound('Guide not found');
  }
  if (!flow.latestRunId) {
    throw notFound('Guide has no published recording');
  }
  return { flowId: flow.id, runId: flow.latestRunId };
};

export const stepsAdminRoute = new Elysia()
  // List all steps for a guide's latest run
  .get('/api/v1/flows/:publicId/steps', async ({ params, request }) => {
    const { organizationId } = await requireSessionAndMember(request);
    const { runId } = await resolveFlowWithLatestRun(params.publicId, organizationId);
    const prisma = getPrisma();

    const steps = await prisma.step.findMany({
      where: { runId },
      orderBy: { order: 'asc' },
      include: { asset: true },
    });

    return {
      steps: steps.map((s) => {
        const report = s.redactionReport as { count?: number; [key: string]: unknown } | null;
        return {
          id: s.id,
          order: s.order,
          action: s.action,
          instruction: s.instruction,
          title: s.title,
          alt: s.alt,
          page_url: s.pageUrl,
          selector: s.selector,
          box: s.box as { x: number; y: number; w: number; h: number } | null,
          image: imageFor(s.asset),
          redaction_mode: s.redactionMode,
          redaction_report: s.redactionReport as Record<string, unknown> | null,
          masked_count: typeof report?.count === 'number' ? report.count : 0,
          hidden: s.hidden,
        };
      }),
    };
  })

  // Update a single step (title, instruction, alt, highlight/box, hidden)
  .patch('/api/v1/flows/:publicId/steps/:stepId', async ({ params, request }) => {
    const { organizationId } = await requireSessionAndMember(request);
    const { flowId, runId } = await resolveFlowWithLatestRun(params.publicId, organizationId);
    const prisma = getPrisma();

    const step = await prisma.step.findFirst({
      where: { id: params.stepId, runId },
    });
    if (!step) {
      throw notFound('Step not found');
    }

    const body = await readJsonBody(request);
    const { title, instruction, alt, box, highlight, hidden } = body;

    if (
      title === undefined &&
      instruction === undefined &&
      alt === undefined &&
      box === undefined &&
      highlight === undefined &&
      hidden === undefined
    ) {
      throw invalid('At least one of title, instruction, alt, box, highlight, or hidden must be provided');
    }

    let finalTitle: string | null | undefined;
    if (title !== undefined) {
      if (title !== null && typeof title !== 'string') throw invalid('title must be a string or null');
      if (typeof title === 'string') {
        const trimmed = title.trim();
        if (trimmed.length > 120) throw invalid('title must be at most 120 characters');
        finalTitle = trimmed.length === 0 ? null : trimmed;
      } else {
        finalTitle = null;
      }
    }

    let finalInstruction: string | undefined;
    if (instruction !== undefined) {
      if (typeof instruction !== 'string') throw invalid('instruction must be a string');
      const trimmed = instruction.trim();
      if (trimmed.length === 0) throw invalid('instruction cannot be empty');
      if (trimmed.length > 1000) throw invalid('instruction must be at most 1000 characters');
      finalInstruction = trimmed;
    }

    let finalAlt: string | null | undefined;
    if (alt !== undefined) {
      if (alt !== null && typeof alt !== 'string') throw invalid('alt must be a string or null');
      if (typeof alt === 'string') {
        const trimmed = alt.trim();
        if (trimmed.length > 300) throw invalid('alt must be at most 300 characters');
        finalAlt = trimmed.length === 0 ? null : trimmed;
      } else {
        finalAlt = null;
      }
    }

    let finalBox: { x: number; y: number; w: number; h: number } | null | undefined;
    if (box !== undefined) {
      if (box === null) {
        finalBox = null;
      } else if (typeof box === 'object') {
        const b = box as Record<string, unknown>;
        if (
          typeof b.x !== 'number' || !Number.isFinite(b.x) ||
          typeof b.y !== 'number' || !Number.isFinite(b.y) ||
          typeof b.w !== 'number' || !Number.isFinite(b.w) ||
          typeof b.h !== 'number' || !Number.isFinite(b.h)
        ) {
          throw invalid('box coordinates must be finite numbers');
        }
        finalBox = { x: b.x, y: b.y, w: b.w, h: b.h };
      } else {
        throw invalid('box must be an object or null');
      }
    } else if (highlight === false) {
      finalBox = null;
    }

    let finalHidden: boolean | undefined;
    if (hidden !== undefined) {
      if (typeof hidden !== 'boolean') throw invalid('hidden must be a boolean');
      finalHidden = hidden;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const updatedStep = await tx.step.update({
        where: { id: step.id },
        data: {
          ...(finalTitle !== undefined ? { title: finalTitle } : {}),
          ...(finalInstruction !== undefined ? { instruction: finalInstruction } : {}),
          ...(finalAlt !== undefined ? { alt: finalAlt } : {}),
          ...(finalBox !== undefined ? { box: finalBox === null ? Prisma.DbNull : finalBox } : {}),
          ...(finalHidden !== undefined ? { hidden: finalHidden } : {}),
        },
        include: { asset: true },
      });

      await refreshSearchDocument(tx, flowId, runId);
      return updatedStep;
    });

    const report = updated.redactionReport as { count?: number; [key: string]: unknown } | null;

    return {
      step: {
        id: updated.id,
        order: updated.order,
        action: updated.action,
        instruction: updated.instruction,
        title: updated.title,
        alt: updated.alt,
        page_url: updated.pageUrl,
        selector: updated.selector,
        box: updated.box as { x: number; y: number; w: number; h: number } | null,
        image: imageFor(updated.asset),
        redaction_mode: updated.redactionMode,
        redaction_report: updated.redactionReport as Record<string, unknown> | null,
        masked_count: typeof report?.count === 'number' ? report.count : 0,
        hidden: updated.hidden,
      },
    };
  })

  // Reorder steps within a guide's latest run
  .post('/api/v1/flows/:publicId/steps/reorder', async ({ params, request }) => {
    const { organizationId } = await requireSessionAndMember(request);
    const { flowId, runId } = await resolveFlowWithLatestRun(params.publicId, organizationId);
    const body = await readJsonBody(request);
    const stepIds = body.step_ids;

    if (!Array.isArray(stepIds) || stepIds.length === 0) {
      throw invalid('step_ids must be a non-empty array of step IDs');
    }
    if (!stepIds.every((id) => typeof id === 'string')) {
      throw invalid('All step_ids must be strings');
    }

    const prisma = getPrisma();
    const currentSteps = await prisma.step.findMany({
      where: { runId },
      select: { id: true },
    });

    if (stepIds.length !== currentSteps.length) {
      throw invalid(`step_ids length (${stepIds.length}) does not match guide steps count (${currentSteps.length})`);
    }

    const currentIdSet = new Set(currentSteps.map((s) => s.id));
    const newIdSet = new Set(stepIds);
    if (newIdSet.size !== stepIds.length) {
      throw invalid('step_ids contains duplicate IDs');
    }
    for (const id of stepIds) {
      if (!currentIdSet.has(id)) {
        throw invalid(`step ID "${id}" does not belong to this guide's current run`);
      }
    }

    await prisma.$transaction(async (tx) => {
      // Pass 1: negative order to prevent collision on @@unique([runId, order])
      for (let i = 0; i < stepIds.length; i++) {
        await tx.step.update({
          where: { id: stepIds[i] },
          data: { order: -(i + 1) },
        });
      }

      // Pass 2: final contiguous 1..N order
      for (let i = 0; i < stepIds.length; i++) {
        await tx.step.update({
          where: { id: stepIds[i] },
          data: { order: i + 1 },
        });
      }

      await refreshSearchDocument(tx, flowId, runId);
    });

    return { ok: true };
  })

  // Delete a step and renumber remaining steps
  .delete('/api/v1/flows/:publicId/steps/:stepId', async ({ params, request }) => {
    const { organizationId } = await requireSessionAndMember(request);
    const { flowId, runId } = await resolveFlowWithLatestRun(params.publicId, organizationId);
    const prisma = getPrisma();

    const step = await prisma.step.findFirst({
      where: { id: params.stepId, runId },
      select: { id: true },
    });
    if (!step) {
      throw notFound('Step not found');
    }

    const remainingCount = await prisma.$transaction(async (tx) => {
      await tx.step.delete({ where: { id: step.id } });

      const remaining = await tx.step.findMany({
        where: { runId },
        orderBy: { order: 'asc' },
        select: { id: true },
      });

      // Pass 1: negative order
      for (let i = 0; i < remaining.length; i++) {
        await tx.step.update({
          where: { id: remaining[i].id },
          data: { order: -(i + 1) },
        });
      }

      // Pass 2: final contiguous 1..N
      for (let i = 0; i < remaining.length; i++) {
        await tx.step.update({
          where: { id: remaining[i].id },
          data: { order: i + 1 },
        });
      }

      await refreshSearchDocument(tx, flowId, runId);
      return remaining.length;
    });

    return { ok: true, remaining: remainingCount };
  })

  // List recording history (runs) for a guide (UI-A16 Finding 1)
  .get('/api/v1/flows/:publicId/runs', async ({ params, request }) => {
    const { organizationId } = await requireSessionAndMember(request);
    const prisma = getPrisma();

    const flow = await prisma.flow.findFirst({
      where: { publicId: params.publicId, organizationId, deletedAt: null },
      select: { id: true, latestRunId: true },
    });
    if (!flow) {
      throw notFound('Guide not found');
    }

    const runs = await prisma.run.findMany({
      where: { flowId: flow.id },
      orderBy: { startedAt: 'desc' },
      include: {
        _count: { select: { steps: true } },
      },
    });

    return {
      runs: runs.map((r) => ({
        id: r.publicId,
        started_at: r.startedAt.toISOString(),
        compiled_at: r.compiledAt ? r.compiledAt.toISOString() : null,
        status: r.status,
        step_count: r._count.steps,
        cli_version: r.cliVersion,
        is_current: r.id === flow.latestRunId,
      })),
    };
  });
