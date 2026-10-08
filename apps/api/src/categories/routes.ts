import { CategoriesResponseSchema } from '@opendocs/core';
import { Elysia } from 'elysia';
import { resolveOrganizationId } from '../auth-context';
import { getPrisma } from '../db';
import { ApiError } from '../errors';
import { requireMember, requireSession } from '../site/session';
import { categorySlug } from './file';

const notFound = (message: string) => new ApiError(404, 'not_found', message);
const invalid = (message: string) => new ApiError(422, 'validation_failed', message);
const conflict = (message: string) => new ApiError(409, 'validation_failed', message);

/**
 * Parse JSON body with validation for category endpoints
 */
const readBody = async (request: Request) => {
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

  return parsed as Record<string, unknown>;
};

/**
 * Validate category name and description
 */
const validateCategoryInput = (
  name: unknown,
  description: unknown,
): { name: string; description: string } => {
  if (typeof name !== 'string') {
    throw invalid('name is required and must be a string');
  }

  const trimmedName = name.trim();
  if (trimmedName.length === 0 || trimmedName.length > 40) {
    throw invalid('name must be 1-40 characters');
  }

  const trimmedDesc = typeof description === 'string' ? description.trim() : '';
  if (trimmedDesc.length > 200) {
    throw invalid('description must be at most 200 characters');
  }

  return { name: trimmedName, description: trimmedDesc };
};

/**
 * Build the category response object with guides count
 */
const categoryToResponse = async (
  tx: any,
  category: { id: string; slug: string; name: string; description: string; status: string },
) => {
  const guides = await tx.flow.count({
    where: { categoryId: category.id, deletedAt: null },
  });

  return {
    id: category.id,
    slug: category.slug,
    name: category.name,
    description: category.description,
    status: category.status,
    guides,
  };
};

export const categoriesRoute = new Elysia()
  .get('/api/v1/categories', async ({ request }) => {
    const organizationId = await resolveOrganizationId(request);
    const prisma = getPrisma();

    const categories = await prisma.category.findMany({
      where: { organizationId },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
    });

    const categoriesWithGuides = await Promise.all(
      categories.map(async (cat) => {
        const guides = await prisma.flow.count({
          where: { categoryId: cat.id, deletedAt: null },
        });
        return {
          id: cat.id,
          slug: cat.slug,
          name: cat.name,
          description: cat.description,
          status: cat.status as 'active' | 'suggested',
          guides,
        };
      }),
    );

    return { categories: categoriesWithGuides };
  }, { response: { 200: CategoriesResponseSchema } })
  .post('/api/v1/categories', async ({ request, status }) => {
    const { userId, organizationId } = await requireSession(request);
    await requireMember(userId, organizationId);

    const body = await readBody(request);
    const { name, description } = validateCategoryInput(body.name, body.description);

    const slug = categorySlug(name);
    if (slug === null) {
      throw invalid('Category name needs letters or numbers');
    }

    const prisma = getPrisma();

    // Check for duplicates
    const existing = await prisma.category.findUnique({
      where: { organizationId_slug: { organizationId, slug } },
    });
    if (existing) {
      throw conflict('A category with this name exists');
    }

    // Check limit
    const count = await prisma.category.count({ where: { organizationId } });
    if (count >= 30) {
      throw invalid('Category limit reached (30)');
    }

    // Find max position
    const [maxPos] = await prisma.$queryRaw<{ max: number | null }[]>`
      SELECT MAX(position) as max FROM "Category" WHERE "organizationId" = ${organizationId}
    `;
    const position = (maxPos?.max ?? -1) + 1;

    const category = await prisma.category.create({
      data: {
        organizationId,
        slug,
        name,
        description,
        source: 'user',
        status: 'active',
        position,
      },
    });

    return status(201, {
      id: category.id,
      slug: category.slug,
      name: category.name,
      description: category.description,
      status: category.status,
      guides: 0,
    });
  })
  .patch('/api/v1/categories/:id', async ({ params, request }) => {
    const { userId, organizationId } = await requireSession(request);
    await requireMember(userId, organizationId);

    const body = await readBody(request);
    const prisma = getPrisma();

    const category = await prisma.category.findFirst({
      where: { id: params.id, organizationId },
    });
    if (!category) {
      throw notFound('Not found');
    }

    // Validate and prepare update data
    const updateData: Record<string, unknown> = {};

    if ('name' in body) {
      if (typeof body.name !== 'string') {
        throw invalid('name must be a string');
      }
      const trimmedName = body.name.trim();
      if (trimmedName.length === 0 || trimmedName.length > 40) {
        throw invalid('name must be 1-40 characters');
      }
      updateData.name = trimmedName;
      // Slug stays the same (only name changes)
    }

    if ('description' in body) {
      if (typeof body.description !== 'string') {
        throw invalid('description must be a string');
      }
      const trimmedDesc = body.description.trim();
      if (trimmedDesc.length > 200) {
        throw invalid('description must be at most 200 characters');
      }
      updateData.description = trimmedDesc;
    }

    if ('position' in body) {
      if (typeof body.position !== 'number' || !Number.isInteger(body.position) || body.position < 0) {
        throw invalid('position must be a non-negative integer');
      }
      updateData.position = body.position;
    }

    if ('status' in body) {
      if (body.status !== 'active') {
        throw invalid('status may only be set to "active"');
      }
      updateData.status = body.status;
    }

    if (Object.keys(updateData).length === 0) {
      // No updates, return current state
      const guides = await prisma.flow.count({
        where: { categoryId: category.id, deletedAt: null },
      });
      return {
        id: category.id,
        slug: category.slug,
        name: category.name,
        description: category.description,
        status: category.status,
        guides,
      };
    }

    const updated = await prisma.category.update({
      where: { id: category.id },
      data: updateData,
    });

    const guides = await prisma.flow.count({
      where: { categoryId: updated.id, deletedAt: null },
    });

    return {
      id: updated.id,
      slug: updated.slug,
      name: updated.name,
      description: updated.description,
      status: updated.status,
      guides,
    };
  })
  .delete('/api/v1/categories/:id', async ({ params, request, status }) => {
    const { userId, organizationId } = await requireSession(request);
    await requireMember(userId, organizationId);

    const prisma = getPrisma();

    const category = await prisma.category.findFirst({
      where: { id: params.id, organizationId },
    });
    if (!category) {
      throw notFound('Not found');
    }

    await prisma.category.delete({ where: { id: category.id } });

    return status(200, { ok: true });
  })
  .put('/api/v1/flows/:publicId/category', async ({ params, request }) => {
    const { userId, organizationId } = await requireSession(request);
    await requireMember(userId, organizationId);

    const body = await readBody(request);
    const categoryId = body.category_id;

    if (categoryId !== null && typeof categoryId !== 'string') {
      throw invalid('category_id must be a string or null');
    }

    const prisma = getPrisma();

    // Find the flow
    const flow = await prisma.flow.findFirst({
      where: { publicId: params.publicId, organizationId, deletedAt: null },
    });
    if (!flow) {
      throw notFound('Not found');
    }

    // If setting a category, validate it belongs to this workspace
    if (categoryId) {
      const category = await prisma.category.findFirst({
        where: { id: categoryId, organizationId },
      });
      if (!category) {
        throw notFound('Not found');
      }
    }

    await prisma.flow.update({
      where: { id: flow.id },
      data: { categoryId: categoryId || null },
    });

    return { ok: true };
  });
