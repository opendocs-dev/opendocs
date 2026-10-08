import {
  AddStepBodySchema,
  AddStepResponseSchema,
  CompileRunBodySchema,
  CompileRunResponseSchema,
  CreateRunBodySchema,
  CreateRunResponseSchema,
  DRAFT_IMAGE_DAYS,
  FREE_STEPS_PER_RUN,
  PUBLIC_ID_LENGTH,
  type AddStepBody,
  type CompileRunBody,
  type CompileRunResponse,
  type CreateRunBody,
} from '@opendocs/core';
import { Value } from '@sinclair/typebox/value';
import { Elysia } from 'elysia';
import { fileUnderCategory } from '../categories/file';
import { resolveOrganizationId } from '../auth-context';
import { getPrisma } from '../db';
import { docUrl } from '../doc-url';
import { ApiError } from '../errors';
import { newPublicId } from '../ids';
import { getPlan } from '../plan';
import { makeGuideSlug, uniqueGuideSlug } from '../site/guide-slug';
import { refreshSearchDocument } from '../site/search-doc';

const invalid = (message: string) => new ApiError(422, 'validation_failed', message);
const notFound = (message: string) => new ApiError(404, 'not_found', message);

const PUBLIC_ID_PATTERN = new RegExp(`^[0-9A-Za-z]{${PUBLIC_ID_LENGTH}}$`);

/**
 * Bodies are read and checked by hand (`parse: 'none'`) for the same reason as the asset
 * upload: a declared schema validates before the handler, and an unauthenticated caller
 * that also sent a bad body must see 401 rather than 422.
 */
const readBody = async <T>(request: Request, schema: Parameters<typeof Value.Check>[0]) => {
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

  if (!Value.Check(schema, parsed)) throw invalid('Request body does not match the contract');
  return parsed as T;
};

export const runsRoute = new Elysia()
  .post(
    '/api/v1/runs',
    async ({ request, status }) => {
      const organizationId = await resolveOrganizationId(request);
      const body = await readBody<CreateRunBody>(request, CreateRunBodySchema);
      const cliVersion = request.headers.get('x-opendocs-cli-version');
      const prisma = getPrisma();

      if (body.flow_id !== undefined) {
        if (!PUBLIC_ID_PATTERN.test(body.flow_id)) {
          throw invalid(`flow_id must be ${PUBLIC_ID_LENGTH} base62 characters`);
        }

        // Scoped to the caller's workspace, so a foreign id is indistinguishable from a
        // missing one.
        const flow = await prisma.flow.findFirst({
          where: { publicId: body.flow_id, organizationId, deletedAt: null },
          select: { id: true },
        });
        if (!flow) throw notFound('Flow not found');

        const startedAt = new Date();
        const run = await prisma.$transaction(async (tx) => {
          const created = await tx.run.create({
            data: { publicId: newPublicId(), flowId: flow.id, cliVersion, startedAt },
            select: { publicId: true },
          });
          await tx.flow.update({ where: { id: flow.id }, data: { lastRunAt: startedAt } });
          return created;
        });

        return status(201, { session_id: run.publicId });
      }

      const publicId = newPublicId();
      const startedAt = new Date();
      const run = await prisma.$transaction(async (tx) => {
        const flow = await tx.flow.create({
          data: {
            publicId: newPublicId(),
            organizationId,
            title: body.title ?? 'Untitled flow',
            lastRunAt: startedAt,
          },
          select: { id: true },
        });

        return tx.run.create({
          data: { publicId, flowId: flow.id, cliVersion, startedAt },
          select: { publicId: true },
        });
      });

      return status(201, { session_id: run.publicId });
    },
    { parse: 'none', response: { 201: CreateRunResponseSchema } },
  )
  // Elysia's router matches `:id`; the contract spells the same path `{id}`.
  .post(
    '/api/v1/runs/:id/steps',
    async ({ params, request, status }) => {
      const organizationId = await resolveOrganizationId(request);
      const body = await readBody<AddStepBody>(request, AddStepBodySchema);
      if (body.redaction && body.redaction.mode !== 'off' && !body.redaction.report) {
        throw new ApiError(
          422,
          'redaction_report_missing',
          `A redaction report is required for mode "${body.redaction.mode}"; use mode "off" if the step has nothing to redact`,
        );
      }
      const redactionMode = body.redaction?.mode ?? 'off';
      const prisma = getPrisma();

      const run = await prisma.run.findFirst({
        // A deleted flow takes its recording runs with it.
        where: { publicId: params.id, flow: { organizationId, deletedAt: null } },
        select: { id: true },
      });
      if (!run) throw notFound('Run not found');

      const asset = await prisma.asset.findFirst({
        where: { publicId: body.asset_id, organizationId },
        select: { id: true },
      });
      if (!asset) throw notFound('Asset not found');

      const plan = await getPlan(organizationId);

      const step = await prisma.$transaction(async (tx) => {
        // The row lock serialises concurrent writers, so the count below and the order it
        // produces cannot be stale.
        const [locked] = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM "Run" WHERE id = ${run.id} FOR UPDATE`;
        // Read under the lock so a concurrent compile cannot slip a step in after it.
        if (locked?.status === 'compiled') {
          throw new ApiError(409, 'run_compiled', 'This run is already compiled');
        }
        const count = await tx.step.count({ where: { runId: run.id } });

        if (plan === 'free' && count >= FREE_STEPS_PER_RUN) {
          throw new ApiError(
            422,
            'step_limit',
            `Free workspaces are limited to ${FREE_STEPS_PER_RUN} steps per run`,
          );
        }

        const created = await tx.step.create({
          data: {
            runId: run.id,
            order: count + 1,
            action: body.action,
            selector: body.selector ?? null,
            // Prisma's nullable Json columns take `undefined` (leave unset), not `null`.
            box: body.box,
            instruction: body.instruction,
            title: body.title ?? null,
            alt: body.alt ?? null,
            pageUrl: body.page_url ?? null,
            assetId: asset.id,
            redactionMode,
            redactionReport: body.redaction?.report,
          },
          select: { order: true },
        });

        if (redactionMode === 'off') {
          await tx.run.update({ where: { id: run.id }, data: { hasUnredactedStep: true } });
        }

        return created;
      });

      return status(201, { order: step.order });
    },
    { parse: 'none', response: { 201: AddStepResponseSchema } },
  )
  .post(
    '/api/v1/runs/:id/compile',
    async ({ params, request }) => {
      const organizationId = await resolveOrganizationId(request);
      const body = await readBody<CompileRunBody>(request, CompileRunBodySchema);
      const prisma = getPrisma();

      const run = await prisma.run.findFirst({
        where: { publicId: params.id, flow: { organizationId, deletedAt: null } },
        select: { id: true, flowId: true, flow: { select: { publicId: true } } },
      });
      if (!run) throw notFound('Run not found');

      const result = await prisma.$transaction(async (tx) => {
        const [locked] = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM "Run" WHERE id = ${run.id} FOR UPDATE`;

        if (locked?.status === 'compiled') {
          return { url: docUrl(run.flow.publicId), categoryStatus: undefined as CompileRunResponse['category_status'] };
        }

        const stepCount = await tx.step.count({ where: { runId: run.id } });
        if (stepCount === 0) {
          throw invalid('A run must have at least one step to compile');
        }

        const now = new Date();
        await tx.run.update({ where: { id: run.id }, data: { status: 'compiled', compiledAt: now } });

        const flow = await tx.flow.findUniqueOrThrow({
          where: { id: run.flowId },
          select: { organizationId: true, latestRunId: true, slug: true, title: true },
        });
        const previousLatestRunId = flow.latestRunId;
        const firstCompile = previousLatestRunId === null;

        // This run becomes the flow's compiled doc: its live step images are permanent.
        await tx.asset.updateMany({
          where: {
            organizationId: flow.organizationId,
            deletedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
            steps: { some: { runId: run.id } },
          },
          data: { expiresAt: null },
        });

        // The run it replaces drops back to a draft window, unless one of its images is
        // also referenced by this run's steps.
        if (previousLatestRunId && previousLatestRunId !== run.id) {
          const graceEnd = new Date(now.getTime() + DRAFT_IMAGE_DAYS * 86_400_000);
          await tx.asset.updateMany({
            where: {
              organizationId: flow.organizationId,
              deletedAt: null,
              OR: [{ expiresAt: null }, { expiresAt: { gt: graceEnd } }],
              steps: { some: { runId: previousLatestRunId } },
              NOT: { steps: { some: { runId: run.id } } },
            },
            data: { expiresAt: graceEnd },
          });
        }

        const effectiveTitle = body?.title !== undefined ? body.title : flow.title;
        let slug = flow.slug;
        if (slug === null) {
          slug = await uniqueGuideSlug(tx, flow.organizationId, makeGuideSlug(effectiveTitle), run.flowId);
        }

        // Handle category and summary on first compile
        let categoryId: string | null | undefined;
        let categoryStatus: CompileRunResponse['category_status'];
        if (firstCompile) {
          if (body?.category !== undefined) {
            const filing = await fileUnderCategory(tx, flow.organizationId, body.category);
            categoryId = filing.categoryId;
            categoryStatus = filing.status;
          }
        }

        await tx.flow.update({
          where: { id: run.flowId },
          data: {
            latestRunId: run.id,
            slug,
            ...(body?.title !== undefined ? { title: body.title } : {}),
            ...(firstCompile && body?.summary !== undefined ? { summary: body.summary.trim() } : {}),
            ...(firstCompile && categoryId !== undefined ? { categoryId } : {}),
          },
        });

        await refreshSearchDocument(tx, run.flowId, run.id);

        return { url: docUrl(run.flow.publicId), categoryStatus };
      });

      const response: CompileRunResponse = { url: result.url };
      if (body?.category !== undefined) {
        response.category_status = result.categoryStatus;
      }
      return response;
    },
    { parse: 'none', response: { 200: CompileRunResponseSchema } },
  );
