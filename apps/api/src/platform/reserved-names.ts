import { Elysia } from 'elysia';
import { ApiError } from '../errors';
import { getPrisma } from '../db';
import { requirePlatformAdmin } from '../platform-guard';
import { validateSlug } from '../site/slug';

const invalid = (message: string) => new ApiError(422, 'validation_failed', message);
const conflict = (message: string) => new ApiError(409, 'validation_failed', message);
const notFound = () => new ApiError(404, 'not_found', 'Not found');

const REASON_MAX_LENGTH = 200;

const readJsonBody = async (request: Request): Promise<Record<string, unknown>> => {
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

  return (parsed as Record<string, unknown>) ?? {};
};

export const platformReservedNamesRoute = new Elysia()
  .get('/api/v1/platform/reserved-names', async ({ request }) => {
    await requirePlatformAdmin(request);

    const names = await getPrisma().reservedName.findMany({ orderBy: { name: 'asc' } });

    return { reserved_names: names.map((row) => ({ name: row.name, reason: row.reason })) };
  })
  .get('/api/v1/platform/reserved-names/check', async ({ request, query }) => {
    await requirePlatformAdmin(request);

    const raw = typeof query.name === 'string' ? query.name : '';
    const validated = validateSlug(raw);
    if (!validated.ok) return { status: 'invalid' as const, reason: validated.reason };
    const { slug } = validated;

    const prisma = getPrisma();

    const reservedRow = await prisma.reservedName.findUnique({ where: { name: slug } });
    if (reservedRow) return { status: 'reserved' as const, reason: reservedRow.reason };

    const existing = await prisma.organization.findUnique({ where: { slug }, select: { id: true } });
    if (existing) return { status: 'taken' as const };

    return { status: 'available' as const };
  })
  .post('/api/v1/platform/reserved-names', async ({ request, status }) => {
    await requirePlatformAdmin(request);

    const body = await readJsonBody(request);
    const rawName = body.name;
    if (typeof rawName !== 'string') throw invalid('name is required');

    const validated = validateSlug(rawName);
    if (!validated.ok) throw invalid(validated.reason);
    const { slug } = validated;

    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (reason.length === 0 || reason.length > REASON_MAX_LENGTH) {
      throw invalid(`reason must be 1-${REASON_MAX_LENGTH} characters`);
    }

    const prisma = getPrisma();

    const existing = await prisma.reservedName.findUnique({ where: { name: slug } });
    if (existing) throw conflict('This name is already reserved');

    const created = await prisma.reservedName.create({ data: { name: slug, reason } });

    return status(201, { name: created.name, reason: created.reason });
  })
  .delete('/api/v1/platform/reserved-names/:name', async ({ request, params, status }) => {
    await requirePlatformAdmin(request);

    const name = params.name.toLowerCase();

    const prisma = getPrisma();
    const existing = await prisma.reservedName.findUnique({ where: { name } });
    if (!existing) throw notFound();

    await prisma.reservedName.delete({ where: { name } });

    return status(200, { ok: true });
  });
