import { Elysia } from 'elysia';
import { assetUrl } from '../asset-url';
import { getPrisma } from '../db';
import { ApiError } from '../errors';
import { requireSession } from './session';

const unauthorized = () => new ApiError(401, 'unauthorized', 'A valid session is required');
const forbidden = () =>
  new ApiError(403, 'unauthorized', 'Only the owner or an admin can change the site settings');

const requireOwnerOrAdmin = async (userId: string, organizationId: string) => {
  const member = await getPrisma().member.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
  });
  if (!member || (member.role !== 'owner' && member.role !== 'admin')) throw forbidden();
};

const readJsonBody = async (request: Request): Promise<Record<string, unknown>> => {
  const text = await request.text().catch(() => {
    throw new ApiError(400, 'validation_failed', 'A JSON request body is required');
  });

  let parsed: unknown = {};
  if (text.trim().length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ApiError(400, 'validation_failed', 'Request body must be valid JSON');
    }
  }

  return (parsed as Record<string, unknown>) ?? {};
};

const invalidAppearance = (reason: string) => new ApiError(422, 'validation_failed', reason);
const ALLOWED_FONTS = [
  'DM Sans',
  'Inter',
  'IBM Plex Sans',
  'Source Sans 3',
  'Lora',
  'Source Serif 4',
  'Bricolage Grotesque',
] as const;
const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;
const invalidSeo = (reason: string) => new ApiError(422, 'validation_failed', reason);
const MAX_SEO_TITLE = 60;
const MAX_SEO_DESCRIPTION = 160;

type SeoUpdate = {
  siteTitle?: string;
  description?: string;
  indexing?: boolean;
  faviconAssetId?: string | null;
  ogAssetId?: string | null;
};

/** Every field is optional; an omitted field is left unchanged (same rule as category-policy). */
const readSeoBody = (body: Record<string, unknown>): SeoUpdate => {
  const update: SeoUpdate = {};

  if (body.site_title !== undefined) {
    if (typeof body.site_title !== 'string') throw invalidSeo('site_title must be a string');
    const trimmed = body.site_title.trim();
    if (trimmed.length < 1 || trimmed.length > MAX_SEO_TITLE) {
      throw invalidSeo(`site_title must be 1 to ${MAX_SEO_TITLE} characters`);
    }
    update.siteTitle = trimmed;
  }

  if (body.description !== undefined) {
    if (typeof body.description !== 'string') throw invalidSeo('description must be a string');
    if (body.description.length > MAX_SEO_DESCRIPTION) {
      throw invalidSeo(`description must be at most ${MAX_SEO_DESCRIPTION} characters`);
    }
    update.description = body.description;
  }

  if (body.indexing !== undefined) {
    if (typeof body.indexing !== 'boolean') throw invalidSeo('indexing must be a boolean');
    update.indexing = body.indexing;
  }

  if (body.favicon_asset_id !== undefined) {
    if (body.favicon_asset_id !== null && typeof body.favicon_asset_id !== 'string') {
      throw invalidSeo('favicon_asset_id must be a string or null');
    }
    update.faviconAssetId = body.favicon_asset_id;
  }

  if (body.og_asset_id !== undefined) {
    if (body.og_asset_id !== null && typeof body.og_asset_id !== 'string') {
      throw invalidSeo('og_asset_id must be a string or null');
    }
    update.ogAssetId = body.og_asset_id;
  }

  return update;
};

/** `assetId: null` clears the field and skips the lookup. */
const requireOwnBrandAsset = async (organizationId: string, assetId: string | null): Promise<void> => {
  if (assetId === null) return;
  const asset = await getPrisma().asset.findFirst({
    where: { id: assetId, organizationId, kind: 'brand', deletedAt: null },
    select: { id: true },
  });
  if (!asset) throw invalidSeo('favicon_asset_id and og_asset_id must be an uploaded brand image you own');
};

export const siteRoute = new Elysia()
  .get('/api/v1/site', async ({ request }) => {
    const { organizationId } = await requireSession(request);
    const prisma = getPrisma();

    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });
    if (!organization) throw unauthorized();

    const site =
      (await prisma.siteSettings.findUnique({
        where: { organizationId },
        include: { faviconAsset: true, ogAsset: true },
      })) ??
      // Created lazily: the instance workspace exists before anyone saves settings.
      (await prisma.siteSettings.create({
        data: { organizationId, siteTitle: organization.name },
        include: { faviconAsset: true, ogAsset: true },
      }));

    return {
      site_title: site.siteTitle,
      tagline: site.tagline,
      preset: site.preset,
      accent: site.accent,
      mark: site.mark,
      font: site.font,
      radius: site.radius,
      indexing: site.indexing,
      category_policy: site.categoryPolicy,
      description: site.description,
      favicon_url: site.faviconAsset ? assetUrl(site.faviconAsset) : null,
      og_image_url: site.ogAsset ? assetUrl(site.ogAsset) : null,
    };
  })
  .put('/api/v1/site/category-policy', async ({ request }) => {
    const { userId, organizationId } = await requireSession(request);
    await requireOwnerOrAdmin(userId, organizationId);

    const body = await readJsonBody(request);
    const policy = body.policy;

    if (policy !== 'suggest' && policy !== 'auto') {
      throw new ApiError(422, 'validation_failed', 'policy must be "suggest" or "auto"');
    }

    const prisma = getPrisma();
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });
    if (!organization) throw unauthorized();

    await prisma.siteSettings.upsert({
      where: { organizationId },
      create: { organizationId, siteTitle: organization.name, categoryPolicy: policy },
      update: { categoryPolicy: policy },
    });

    return { policy };
  })
  /** Appearance and preset selection (C14-AC11). Presets are "sage", "atlas", and "ledger". */
  .get('/api/v1/site/appearance', async ({ request }) => {
    const { organizationId } = await requireSession(request);
    const prisma = getPrisma();
    const site = await prisma.siteSettings.findUnique({
      where: { organizationId },
      select: {
        preset: true,
        accent: true,
        mark: true,
        font: true,
        radius: true,
      },
    });
    return {
      preset: site?.preset ?? 'sage',
      accent: site?.accent ?? null,
      mark: site?.mark ?? null,
      font: site?.font ?? null,
      radius: site?.radius ?? null,
    };
  })
  .put('/api/v1/site/appearance', async ({ request }) => {
    const { userId, organizationId } = await requireSession(request);
    await requireOwnerOrAdmin(userId, organizationId);

    const body = await readJsonBody(request);
    const preset = body.preset;

    const hasCustomBranding =
      (body.accent !== undefined && body.accent !== null) ||
      (body.mark !== undefined && body.mark !== null) ||
      (body.font !== undefined && body.font !== null) ||
      (body.radius !== undefined && body.radius !== null);

    if (preset !== undefined || !hasCustomBranding) {
      if (preset !== 'sage' && preset !== 'atlas' && preset !== 'ledger') {
        throw new ApiError(422, 'validation_failed', 'preset must be "sage", "atlas", or "ledger"');
      }
    }

    if (body.accent !== undefined && body.accent !== null) {
      if (typeof body.accent !== 'string' || !HEX_COLOR_REGEX.test(body.accent)) {
        throw invalidAppearance('accent must be a valid 6-character hex color (e.g. #0F6B54)');
      }
    }

    if (body.mark !== undefined && body.mark !== null) {
      if (typeof body.mark !== 'string' || !HEX_COLOR_REGEX.test(body.mark)) {
        throw invalidAppearance('mark must be a valid 6-character hex color (e.g. #FFD54A)');
      }
    }

    if (body.font !== undefined && body.font !== null) {
      if (typeof body.font !== 'string' || !ALLOWED_FONTS.includes(body.font as any)) {
        throw invalidAppearance(`font must be one of: ${ALLOWED_FONTS.join(', ')}`);
      }
    }

    if (body.radius !== undefined && body.radius !== null) {
      if (typeof body.radius !== 'number' || !Number.isInteger(body.radius) || body.radius < 0 || body.radius > 20) {
        throw invalidAppearance('radius must be an integer between 0 and 20');
      }
    }

    const prisma = getPrisma();
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });
    if (!organization) throw unauthorized();

    const updateData: Record<string, unknown> = {};
    if (preset !== undefined) updateData.preset = preset;
    if (body.accent !== undefined) updateData.accent = body.accent;
    if (body.mark !== undefined) updateData.mark = body.mark;
    if (body.font !== undefined) updateData.font = body.font;
    if (body.radius !== undefined) updateData.radius = body.radius;

    const site = await prisma.siteSettings.upsert({
      where: { organizationId },
      create: {
        organizationId,
        siteTitle: organization.name,
        preset: typeof preset === 'string' ? preset : 'sage',
        accent: (body.accent as string | null) ?? null,
        mark: (body.mark as string | null) ?? null,
        font: (body.font as string | null) ?? null,
        radius: (body.radius as number | null) ?? null,
      },
      update: updateData,
    });

    return {
      preset: site.preset,
      accent: site.accent,
      mark: site.mark,
      font: site.font,
      radius: site.radius,
    };
  })
  /**
   * Site title, description, favicon and share image (C14-AC13). All fields optional,
   * like category-policy: an omitted field is left unchanged. Favicon and share image are
   * Asset ids of kind "brand" the caller already uploaded via /api/v1/assets; null clears
   * either back to the default.
   */
  .put('/api/v1/site/seo', async ({ request }) => {
    const { userId, organizationId } = await requireSession(request);
    await requireOwnerOrAdmin(userId, organizationId);

    const body = await readJsonBody(request);
    const { siteTitle, description, indexing, faviconAssetId, ogAssetId } = readSeoBody(body);

    const prisma = getPrisma();
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });
    if (!organization) throw unauthorized();

    if (faviconAssetId !== undefined) await requireOwnBrandAsset(organizationId, faviconAssetId);
    if (ogAssetId !== undefined) await requireOwnBrandAsset(organizationId, ogAssetId);

    const data: Record<string, unknown> = {};
    if (siteTitle !== undefined) data.siteTitle = siteTitle;
    if (description !== undefined) data.description = description;
    if (indexing !== undefined) data.indexing = indexing;
    if (faviconAssetId !== undefined) data.faviconAssetId = faviconAssetId;
    if (ogAssetId !== undefined) data.ogAssetId = ogAssetId;

    const site = await prisma.siteSettings.upsert({
      where: { organizationId },
      create: { organizationId, siteTitle: organization.name, ...data },
      update: data,
      include: { faviconAsset: true, ogAsset: true },
    });

    return {
      site_title: site.siteTitle,
      description: site.description,
      indexing: site.indexing,
      favicon_url: site.faviconAsset ? assetUrl(site.faviconAsset) : null,
      og_image_url: site.ogAsset ? assetUrl(site.ogAsset) : null,
    };
  });
