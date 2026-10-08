import type { Prisma } from '../../generated/prisma/client';
import { makeGuideSlug } from '../site/guide-slug';

/**
 * Slug for a category name, or null if the name has no letters or numbers.
 */
export const categorySlug = (name: string): string | null => {
  const slug = makeGuideSlug(name);
  // makeGuideSlug returns 'guide' when input has no alphanumerics;
  // we return null to signal an invalid category name.
  return slug === 'guide' && !name.toLowerCase().match(/[a-z0-9]/) ? null : slug;
};

/**
 * Files or creates a category for a guide being compiled, checking workspace policy and limits.
 * Returns { categoryId, status } where:
 * - categoryId is the matched or new category id, or null if filing failed
 * - status is 'filed' | 'suggested' | 'cap_reached' | 'none'
 *
 * tx: A Prisma transaction client (like the ones used in runs.ts compile)
 * organizationId: The workspace id
 * name: The category name (already validated by core schema as 1-40 chars)
 */
export const fileUnderCategory = async (
  tx: Prisma.TransactionClient,
  organizationId: string,
  name: string,
): Promise<{ categoryId: string | null; status: 'filed' | 'suggested' | 'cap_reached' | 'none' }> => {
  const slug = categorySlug(name);
  if (slug === null) {
    return { categoryId: null, status: 'none' };
  }

  // Match by slug, ignoring hyphens too, so "Whats-App" and "WhatsApp" share a category (C17 D3).
  // A workspace has at most 30 categories, so scanning them is cheap.
  const squash = (value: string) => value.replace(/-/g, '');
  const categories = await tx.category.findMany({
    where: { organizationId },
    select: { id: true, slug: true, status: true },
  });
  const existing = categories.find((c) => c.slug === slug) ?? categories.find((c) => squash(c.slug) === squash(slug));

  if (existing) {
    const status = existing.status === 'suggested' ? 'suggested' : 'filed';
    return { categoryId: existing.id, status };
  }

  // Check if workspace has reached the 30-category limit
  const count = await tx.category.count({ where: { organizationId } });
  if (count >= 30) {
    return { categoryId: null, status: 'cap_reached' };
  }

  // Read workspace policy (defaults to 'suggest')
  const site = await tx.siteSettings.findUnique({
    where: { organizationId },
    select: { categoryPolicy: true },
  });
  const policy = site?.categoryPolicy ?? 'suggest';

  // Find the max position to set the new position
  const [maxPos] = await tx.$queryRaw<{ max: number | null }[]>`
    SELECT MAX(position) as max FROM "Category" WHERE "organizationId" = ${organizationId}
  `;
  const position = (maxPos?.max ?? -1) + 1;

  // Create the new category
  const created = await tx.category.create({
    data: {
      organizationId,
      slug,
      name: name.trim().slice(0, 40),
      source: 'agent',
      status: policy === 'auto' ? 'active' : 'suggested',
      position,
    },
    select: { id: true },
  });

  return {
    categoryId: created.id,
    status: policy === 'auto' ? 'filed' : 'suggested',
  };
};
