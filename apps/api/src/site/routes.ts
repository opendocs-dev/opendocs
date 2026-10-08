import { Elysia } from 'elysia';
import { auth } from '../auth';
import { getPrisma } from '../db';
import { ApiError } from '../errors';
import { getPlan } from '../plan';
import { startOfUtcDay } from '../quota';
import { checkCnameMatch, expectedCnameTarget, validateDomain } from './domain';
import { requireSession } from './session';
import { validateSlug } from './slug';
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

const unauthorized = () => new ApiError(401, 'unauthorized', 'A valid session is required');
const forbidden = () =>
  new ApiError(403, 'unauthorized', 'Only the owner or an admin can change the site address');
const invalidSlug = (reason: string) => new ApiError(400, 'validation_failed', reason);
const reserved = () => new ApiError(409, 'validation_failed', 'Address is reserved');
const taken = () => new ApiError(409, 'validation_failed', 'Address is already in use');
const quotaExceeded = () =>
  new ApiError(429, 'quota_exceeded', 'Address can be changed at most 3 times per day');
const invalidDomain = (reason: string) => new ApiError(400, 'validation_failed', reason);
const domainTaken = () => new ApiError(409, 'validation_failed', 'Domain is already in use');

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

/** Tenant routing is off when the base domain is unset, so every host stays null. */
const hostFor = (slug: string): string | null => {
  const base = process.env.TENANT_BASE_DOMAIN;
  return base ? `${slug}.${base}` : null;
};

/** True when `slug` is retired history that belongs to a different organization. */
const isTakenByHistory = async (slug: string, organizationId: string): Promise<boolean> => {
  const history = await getPrisma().siteAddressHistory.findUnique({ where: { slug } });
  if (!history) return false;
  const stillFresh = Date.now() - history.retiredAt.getTime() < NINETY_DAYS_MS;
  return stillFresh && history.organizationId !== organizationId;
};

const readSlugBody = async (request: Request): Promise<string> => {
  const text = await request.text().catch(() => {
    throw invalidSlug('A JSON request body is required');
  });

  let parsed: unknown = {};
  if (text.trim().length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw invalidSlug('Request body must be valid JSON');
    }
  }

  const slug = (parsed as { slug?: unknown } | null)?.slug;
  if (typeof slug !== 'string') throw invalidSlug('slug is required');
  return slug;
};

/** `domain: ""` or `domain: null` both mean "clear the custom domain". */
const readDomainBody = async (request: Request): Promise<string> => {
  const text = await request.text().catch(() => {
    throw invalidDomain('A JSON request body is required');
  });

  let parsed: unknown = {};
  if (text.trim().length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw invalidDomain('Request body must be valid JSON');
    }
  }

  const domain = (parsed as { domain?: unknown } | null)?.domain;
  if (domain === null || domain === undefined) return '';
  if (typeof domain !== 'string') throw invalidDomain('domain must be a string');
  return domain;
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
const MAX_CUSTOM_META = 10;
const MAX_META_NAME = 60;
const MAX_META_CONTENT = 300;
/** Blocks anything that could open a tag; names and content are rendered as attribute values only. */
const HAS_MARKUP = /[<>]/;

type SeoUpdate = {
  siteTitle?: string;
  description?: string;
  indexing?: boolean;
  faviconAssetId?: string | null;
  ogAssetId?: string | null;
  customMeta?: { name: string; content: string }[];
};

const readCustomMeta = (raw: unknown): { name: string; content: string }[] => {
  if (!Array.isArray(raw)) throw invalidSeo('custom_meta must be an array');
  if (raw.length > MAX_CUSTOM_META) {
    throw invalidSeo(`custom_meta accepts at most ${MAX_CUSTOM_META} entries`);
  }
  return raw.map((entry) => {
    const name = (entry as { name?: unknown } | null)?.name;
    const content = (entry as { content?: unknown } | null)?.content;
    if (typeof name !== 'string' || name.trim().length === 0 || name.length > MAX_META_NAME) {
      throw invalidSeo(`custom_meta name must be 1 to ${MAX_META_NAME} characters`);
    }
    if (typeof content !== 'string' || content.length > MAX_META_CONTENT) {
      throw invalidSeo(`custom_meta content must be at most ${MAX_META_CONTENT} characters`);
    }
    if (HAS_MARKUP.test(name) || HAS_MARKUP.test(content)) {
      throw invalidSeo('custom_meta cannot contain "<" or ">" (scripts and tags are rejected)');
    }
    return { name: name.trim(), content };
  });
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

  if (body.custom_meta !== undefined) {
    update.customMeta = readCustomMeta(body.custom_meta);
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

const assetUrl = (publicId: string): string => `${process.env.ASSET_BASE_URL}/i/${publicId}`;

export const siteRoute = new Elysia()
  .get('/api/v1/site/address-check', async ({ request, query }) => {
    const { organizationId } = await requireSession(request);
    const raw = typeof query.slug === 'string' ? query.slug : '';

    const validated = validateSlug(raw);
    if (!validated.ok) return { status: 'invalid' as const, reason: validated.reason };
    const { slug } = validated;

    const prisma = getPrisma();

    const reservedRow = await prisma.reservedName.findUnique({ where: { name: slug } });
    if (reservedRow) return { status: 'reserved' as const, reason: reservedRow.reason };

    const existing = await prisma.organization.findUnique({ where: { slug }, select: { id: true } });
    if (existing) return { status: 'taken' as const };

    if (await isTakenByHistory(slug, organizationId)) return { status: 'taken' as const };

    return { status: 'available' as const };
  })
  .get('/api/v1/site', async ({ request }) => {
    const { organizationId } = await requireSession(request);
    const prisma = getPrisma();

    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { slug: true, name: true },
    });
    if (!organization) throw unauthorized();

    const site =
      (await prisma.workspaceSite.findUnique({
        where: { organizationId },
        include: { faviconAsset: true, ogAsset: true },
      })) ??
      // No clean Better-Auth hook fires for the direct `organization.create` used by the
      // personal-workspace signup path (see auth.ts), so the row is created lazily here.
      (await prisma.workspaceSite.create({
        data: { organizationId, siteTitle: organization.name },
        include: { faviconAsset: true, ogAsset: true },
      }));

    return {
      address: { slug: organization.slug, host: hostFor(organization.slug) },
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
      favicon_url: site.faviconAsset ? assetUrl(site.faviconAsset.publicId) : null,
      og_image_url: site.ogAsset ? assetUrl(site.ogAsset.publicId) : null,
      custom_meta: site.customMeta as { name: string; content: string }[],
      domain: {
        custom_domain: site.customDomain,
        status: site.domainStatus,
        cname_target: expectedCnameTarget(organization.slug, process.env.TENANT_BASE_DOMAIN ?? ''),
        cert_expires_at: site.certExpiresAt?.toISOString() ?? null,
        last_checked_at: site.lastCheckedAt?.toISOString() ?? null,
      },
    };
  })
  .put('/api/v1/site/address', async ({ request, status }) => {
    const { userId, organizationId } = await requireSession(request);
    await requireOwnerOrAdmin(userId, organizationId);

    const raw = await readSlugBody(request);
    const validated = validateSlug(raw);
    if (!validated.ok) throw invalidSlug(validated.reason);
    const { slug } = validated;

    const prisma = getPrisma();

    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { slug: true, name: true },
    });
    if (!organization) throw unauthorized();

    if (organization.slug === slug) {
      return status(200, { slug, host: hostFor(slug) });
    }

    const reservedRow = await prisma.reservedName.findUnique({ where: { name: slug } });
    if (reservedRow) throw reserved();

    const existing = await prisma.organization.findUnique({ where: { slug }, select: { id: true } });
    if (existing) throw taken();

    if (await isTakenByHistory(slug, organizationId)) throw taken();

    const now = new Date();
    const today = startOfUtcDay(now);
    try {
      await prisma.$transaction(async (tx) => {
        // Row lock on this workspace's site: two concurrent changes run one after the other,
        // so the daily count below cannot be raced past. The row may not exist yet (lazy create).
        await tx.workspaceSite.upsert({
          where: { organizationId },
          create: { organizationId, siteTitle: organization.name },
          update: {},
        });
        await tx.$queryRaw`SELECT 1 FROM "WorkspaceSite" WHERE "organizationId" = ${organizationId} FOR UPDATE`;
        const site = await tx.workspaceSite.findUniqueOrThrow({ where: { organizationId } });
        const usedToday =
          site.addressChangeDay && site.addressChangeDay.getTime() === today.getTime()
            ? site.addressChangeCount
            : 0;
        if (usedToday >= 3) throw quotaExceeded();

        // Upsert, not create: the old slug may already sit in history from a previous
        // owner if it was reclaimed after its 90-day redirect window expired.
        await tx.siteAddressHistory.upsert({
          where: { slug: organization.slug },
          create: { slug: organization.slug, organizationId, retiredAt: now },
          update: { organizationId, retiredAt: now },
        });
        await tx.organization.update({ where: { id: organizationId }, data: { slug } });
        await tx.workspaceSite.update({
          where: { organizationId },
          data: { addressChangeDay: today, addressChangeCount: usedToday + 1 },
        });
      });
    } catch (error) {
      // Another workspace took the slug between the check above and the update.
      if ((error as { code?: string }).code === 'P2002') throw taken();
      throw error;
    }

    return status(200, { slug, host: hostFor(slug) });
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

    await prisma.workspaceSite.upsert({
      where: { organizationId },
      create: { organizationId, siteTitle: organization.name, categoryPolicy: policy },
      update: { categoryPolicy: policy },
    });

    return { policy };
  })
  /**
   * Appearance and preset selection (C14-AC11). Presets are "sage", "atlas", and "ledger".
   * Free plan is gated to "sage" only; Pro and Enterprise can choose any of the three.
   */
  .get('/api/v1/site/appearance', async ({ request }) => {
    const { organizationId } = await requireSession(request);
    const prisma = getPrisma();
    const site = await prisma.workspaceSite.findUnique({
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

    const plan = await getPlan(organizationId);
    if (plan === 'free' && preset !== undefined && preset !== 'sage') {
      throw new ApiError(403, 'unauthorized', 'The atlas and ledger presets require a Pro or Enterprise plan');
    }

    if (hasCustomBranding && plan !== 'enterprise') {
      throw new ApiError(403, 'unauthorized', 'Custom branding requires an Enterprise plan');
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

    const site = await prisma.workspaceSite.upsert({
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
   * Site title, description, favicon, share image and custom meta tags (C14-AC13). All
   * fields optional, like category-policy: an omitted field is left unchanged. Favicon and
   * share image are Asset ids of kind "brand" the caller already uploaded via /api/v1/assets;
   * null clears either back to the platform default.
   */
  .put('/api/v1/site/seo', async ({ request }) => {
    const { userId, organizationId } = await requireSession(request);
    await requireOwnerOrAdmin(userId, organizationId);

    const body = await readJsonBody(request);
    const { siteTitle, description, indexing, faviconAssetId, ogAssetId, customMeta } =
      readSeoBody(body);

    const prisma = getPrisma();
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });
    if (!organization) throw unauthorized();

    if (faviconAssetId !== undefined) await requireOwnBrandAsset(organizationId, faviconAssetId);
    if (ogAssetId !== undefined) await requireOwnBrandAsset(organizationId, ogAssetId);

    if (customMeta !== undefined && customMeta.length > 0) {
      const plan = await getPlan(organizationId);
      if (plan !== 'enterprise') {
        throw new ApiError(403, 'unauthorized', 'Custom meta tags require an Enterprise plan');
      }
    }

    const data: Record<string, unknown> = {};
    if (siteTitle !== undefined) data.siteTitle = siteTitle;
    if (description !== undefined) data.description = description;
    if (indexing !== undefined) data.indexing = indexing;
    if (faviconAssetId !== undefined) data.faviconAssetId = faviconAssetId;
    if (ogAssetId !== undefined) data.ogAssetId = ogAssetId;
    if (customMeta !== undefined) data.customMeta = customMeta;

    const site = await prisma.workspaceSite.upsert({
      where: { organizationId },
      create: { organizationId, siteTitle: organization.name, ...data },
      update: data,
      include: { faviconAsset: true, ogAsset: true },
    });

    return {
      site_title: site.siteTitle,
      description: site.description,
      indexing: site.indexing,
      favicon_url: site.faviconAsset ? assetUrl(site.faviconAsset.publicId) : null,
      og_image_url: site.ogAsset ? assetUrl(site.ogAsset.publicId) : null,
      custom_meta: site.customMeta as { name: string; content: string }[],
    };
  })
  /**
   * Sets or clears the workspace's own domain (C14-AC12). `domainStatus` here is DNS-only:
   * "verified" means the CNAME was found, not that a certificate exists or the host answers
   * HTTPS. Certificate issuance is unresolved (Platform Changes "Infrastructure" table says
   * Cloudflare custom hostnames is only a candidate), so `cert_failing` and `certExpiresAt`
   * stay unused until that is decided; see Issue - OD Domain Verification.
   */
  .put('/api/v1/site/custom-domain', async ({ request }) => {
    const { userId, organizationId } = await requireSession(request);
    await requireOwnerOrAdmin(userId, organizationId);

    const raw = await readDomainBody(request);

    const prisma = getPrisma();
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { slug: true, name: true },
    });
    if (!organization) throw unauthorized();

    if (raw.trim() === '') {
      await prisma.workspaceSite.upsert({
        where: { organizationId },
        create: { organizationId, siteTitle: organization.name },
        update: { customDomain: null, domainStatus: null, certExpiresAt: null, lastCheckedAt: null },
      });
      return {
        custom_domain: null,
        status: null,
        cname_target: expectedCnameTarget(organization.slug, process.env.TENANT_BASE_DOMAIN ?? ''),
        cert_expires_at: null,
        last_checked_at: null,
      };
    }

    const validated = validateDomain(raw);
    if (!validated.ok) throw invalidDomain(validated.reason);
    const { domain } = validated;

    const existing = await prisma.workspaceSite.findUnique({
      where: { customDomain: domain },
      select: { organizationId: true },
    });
    if (existing && existing.organizationId !== organizationId) throw domainTaken();

    const target = expectedCnameTarget(organization.slug, process.env.TENANT_BASE_DOMAIN ?? '');
    const found = await checkCnameMatch(domain, target);
    const now = new Date();

    try {
      await prisma.workspaceSite.upsert({
        where: { organizationId },
        create: {
          organizationId,
          siteTitle: organization.name,
          customDomain: domain,
          domainStatus: found ? 'verified' : 'waiting_dns',
          lastCheckedAt: now,
        },
        update: {
          customDomain: domain,
          domainStatus: found ? 'verified' : 'waiting_dns',
          lastCheckedAt: now,
        },
      });
    } catch (error) {
      // Another workspace claimed the same domain between the check above and the write.
      if ((error as { code?: string }).code === 'P2002') throw domainTaken();
      throw error;
    }

    return {
      custom_domain: domain,
      status: found ? ('verified' as const) : ('waiting_dns' as const),
      cname_target: target,
      cert_expires_at: null,
      last_checked_at: now.toISOString(),
    };
  })
  /** Re-runs the DNS check against the domain already on file; same DNS-only status rule as above. */
  .post('/api/v1/site/custom-domain/recheck', async ({ request }) => {
    const { userId, organizationId } = await requireSession(request);
    await requireOwnerOrAdmin(userId, organizationId);

    const prisma = getPrisma();
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { slug: true },
    });
    if (!organization) throw unauthorized();

    const site = await prisma.workspaceSite.findUnique({ where: { organizationId } });
    if (!site?.customDomain) {
      throw new ApiError(400, 'validation_failed', 'No custom domain is set');
    }

    const target = expectedCnameTarget(organization.slug, process.env.TENANT_BASE_DOMAIN ?? '');
    const found = await checkCnameMatch(site.customDomain, target);
    const now = new Date();

    await prisma.workspaceSite.update({
      where: { organizationId },
      data: { domainStatus: found ? 'verified' : 'waiting_dns', lastCheckedAt: now },
    });

    return {
      custom_domain: site.customDomain,
      status: found ? ('verified' as const) : ('waiting_dns' as const),
      cname_target: target,
      cert_expires_at: site.certExpiresAt?.toISOString() ?? null,
      last_checked_at: now.toISOString(),
    };
  })
  /**
   * Public and unauthenticated: only the web tenant middleware calls this. The response
   * never carries an id, so a leaked cache entry reveals nothing about the organization.
   */
  .get('/api/v1/site/resolve', async ({ query, set }) => {
    set.headers['cache-control'] = 'public, max-age=30';

    const rawDomain = typeof query.domain === 'string' ? query.domain.trim().toLowerCase() : '';
    const rawSlug = typeof query.slug === 'string' ? query.slug.trim().toLowerCase() : '';

    const prisma = getPrisma();

    if (rawDomain) {
      const site = await prisma.workspaceSite.findUnique({
        where: { customDomain: rawDomain },
        include: { organization: { select: { slug: true, suspendedAt: true } } },
      });
      if (!site || site.domainStatus === 'blocked' || !site.organization || site.organization.suspendedAt) {
        return { status: 'missing' as const };
      }
      if (site.domainStatus !== 'verified') {
        return { status: 'missing' as const };
      }
      return { status: 'active' as const, slug: site.organization.slug };
    }

    if (!rawSlug) return { status: 'missing' as const };

    const organization = await prisma.organization.findUnique({
      where: { slug: rawSlug },
      select: { suspendedAt: true },
    });
    if (organization) {
      return organization.suspendedAt ? { status: 'missing' as const } : { status: 'active' as const };
    }

    const history = await prisma.siteAddressHistory.findUnique({
      where: { slug: rawSlug },
      select: { retiredAt: true, organizationId: true },
    });
    if (history && Date.now() - history.retiredAt.getTime() < NINETY_DAYS_MS) {
      const owner = await prisma.organization.findUnique({
        where: { id: history.organizationId },
        select: { slug: true, suspendedAt: true },
      });
      if (!owner || owner.suspendedAt) return { status: 'missing' as const };
      return { status: 'redirect' as const, slug: owner.slug };
    }

    // Fallback: check if rawSlug is a custom domain
    const site = await prisma.workspaceSite.findUnique({
      where: { customDomain: rawSlug },
      include: { organization: { select: { slug: true, suspendedAt: true } } },
    });
    if (site && site.domainStatus !== 'blocked' && site.domainStatus === 'verified' && site.organization && !site.organization.suspendedAt) {
      return { status: 'active' as const, slug: site.organization.slug };
    }

    return { status: 'missing' as const };
  });
