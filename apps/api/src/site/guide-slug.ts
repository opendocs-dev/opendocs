import type { Prisma } from '../../generated/prisma/client';

const MAX_SLUG_LENGTH = 60;

/** Lowercase title, non `[a-z0-9]` runs collapsed to `-`, trimmed, cut to 60, `guide` when empty. */
export const makeGuideSlug = (title: string): string => {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/^-+|-+$/g, '');

  return base === '' ? 'guide' : base;
};

/**
 * First free slug among the workspace's flows: `base`, then `base-2`, `base-3`, ...
 * `exceptFlowId` excludes the flow being compiled from the clash check, so a flow
 * keeps its own slug across recompiles.
 */
export const uniqueGuideSlug = async (
  tx: Prisma.TransactionClient,
  organizationId: string,
  base: string,
  exceptFlowId: string,
): Promise<string> => {
  const taken = await tx.flow.findMany({
    where: { organizationId, id: { not: exceptFlowId }, slug: { startsWith: base } },
    select: { slug: true },
  });
  const takenSlugs = new Set(taken.map((flow) => flow.slug));

  if (!takenSlugs.has(base)) return base;

  let n = 2;
  while (takenSlugs.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
};
