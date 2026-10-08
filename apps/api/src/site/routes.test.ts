import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { BASE_URL, cleanDatabase, OTHER_GITHUB_ACCOUNT, realFetch, signIn, type App } from '../../test/helpers';
import { createApp } from '../index';
import { getPrisma } from '../db';

const prisma = getPrisma();

const getSite = (app: App, cookie: string) =>
  app.handle(new Request(`${BASE_URL}/api/v1/site`, { headers: { cookie } }));

const putCategoryPolicy = (app: App, cookie: string, policy: string) =>
  app.handle(
    new Request(`${BASE_URL}/api/v1/site/category-policy`, {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ policy }),
    }),
  );
const getAppearance = (app: App, cookie: string) =>
  app.handle(
    new Request(`${BASE_URL}/api/v1/site/appearance`, {
      method: 'GET',
      headers: { cookie },
    }),
  );

const putAppearance = (app: App, cookie: string, preset: unknown) =>
  app.handle(
    new Request(`${BASE_URL}/api/v1/site/appearance`, {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ preset }),
    }),
  );

const putAppearanceBody = (app: App, cookie: string, body: Record<string, unknown>) =>
  app.handle(
    new Request(`${BASE_URL}/api/v1/site/appearance`, {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );


const putSeo = (app: App, cookie: string, body: Record<string, unknown>) =>
  app.handle(
    new Request(`${BASE_URL}/api/v1/site/seo`, {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

const seedBrandAsset = (organizationId: string) =>
  prisma.asset.create({
    data: {
      publicId: `brand${Math.random().toString(36).slice(2, 10)}`,
      organizationId,
      kind: 'brand',
      providerFileId: crypto.randomUUID(),
      mime: 'image/png',
      bytes: 100,
      width: 32,
      height: 32,
      sha256: 'a'.repeat(64),
      expiresAt: null,
    },
  });

const errorBody = async (response: Response) =>
  (await response.json()) as { error: { code: string; message: string } };

beforeEach(async () => {
  await cleanDatabase();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

afterAll(async () => {
  await cleanDatabase();
});

test('GET /api/v1/site upserts the instance site settings and exposes no address fields', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);

  const response = await getSite(app, cookie);
  expect(response.status).toBe(200);
  const body = (await response.json()) as Record<string, unknown>;
  expect(body.tagline).toBe('');
  expect(body.preset).toBe('sage');
  expect(body.indexing).toBe(true);
  expect(body.category_policy).toBe('suggest');
  expect(body).not.toHaveProperty('address');
  expect(body).not.toHaveProperty('domain');
  expect(body).not.toHaveProperty('custom_meta');

  const organization = await prisma.organization.findFirstOrThrow();
  expect(body.site_title).toBe(organization.name);

  const site = await prisma.siteSettings.findUnique({ where: { organizationId: organization.id } });
  expect(site).not.toBeNull();
});

test('a fresh workspace returns category_policy suggest; after PUT it returns auto', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);

  let response = await getSite(app, cookie);
  let body = (await response.json()) as { category_policy: string };
  expect(body.category_policy).toBe('suggest');

  response = await putCategoryPolicy(app, cookie, 'auto');
  expect(response.status).toBe(200);
  const put = (await response.json()) as { policy: string };
  expect(put.policy).toBe('auto');

  response = await getSite(app, cookie);
  body = (await response.json()) as { category_policy: string };
  expect(body.category_policy).toBe('auto');
});

test('PUT /api/v1/site/seo updates title, description, indexing and reports them back on GET', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);

  const response = await putSeo(app, cookie, {
    site_title: 'Acme Help',
    description: 'Guides for Acme',
    indexing: false,
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { site_title: string; description: string; indexing: boolean };
  expect(body.site_title).toBe('Acme Help');
  expect(body.description).toBe('Guides for Acme');
  expect(body.indexing).toBe(false);

  const getResponse = await getSite(app, cookie);
  const getBody = (await getResponse.json()) as { site_title: string; description: string; indexing: boolean };
  expect(getBody.site_title).toBe('Acme Help');
  expect(getBody.description).toBe('Guides for Acme');
  expect(getBody.indexing).toBe(false);
});

test('PUT /api/v1/site/seo sets the favicon and share image to an owned brand asset', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  const organization = await prisma.organization.findFirstOrThrow();
  const favicon = await seedBrandAsset(organization.id);
  const og = await seedBrandAsset(organization.id);

  const response = await putSeo(app, cookie, {
    favicon_asset_id: favicon.id,
    og_asset_id: og.id,
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { favicon_url: string | null; og_image_url: string | null };
  expect(body.favicon_url).toBe(`${BASE_URL}/api/i/${favicon.publicId}`);
  expect(body.og_image_url).toBe(`${BASE_URL}/api/i/${og.publicId}`);
});

test('PUT /api/v1/site/seo clears the favicon with a null asset id', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  const organization = await prisma.organization.findFirstOrThrow();
  const favicon = await seedBrandAsset(organization.id);
  await putSeo(app, cookie, { favicon_asset_id: favicon.id });

  const response = await putSeo(app, cookie, { favicon_asset_id: null });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { favicon_url: string | null };
  expect(body.favicon_url).toBeNull();
});

test('PUT /api/v1/site/seo rejects a favicon_asset_id that is not a brand asset you own', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  const organization = await prisma.organization.findFirstOrThrow();

  // A step-kind asset, even in the same workspace, is not a valid brand image.
  const stepAsset = await prisma.asset.create({
    data: {
      publicId: 'stepasset0001',
      organizationId: organization.id,
      kind: 'step',
      providerFileId: crypto.randomUUID(),
      mime: 'image/png',
      bytes: 100,
      width: 32,
      height: 32,
      sha256: 'b'.repeat(64),
      expiresAt: null,
    },
  });

  const response = await putSeo(app, cookie, { favicon_asset_id: stepAsset.id });
  expect(response.status).toBe(422);
  expect((await errorBody(response)).error.code).toBe('validation_failed');
});

test('PUT /api/v1/site/seo rejects a site_title over 60 characters', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);

  const response = await putSeo(app, cookie, { site_title: 'x'.repeat(61) });
  expect(response.status).toBe(422);
});

test('a non-owner/admin member cannot change SEO settings', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  const organization = await prisma.organization.findFirstOrThrow();
  const owner = await prisma.member.findFirstOrThrow({ where: { organizationId: organization.id } });
  await prisma.member.update({ where: { id: owner.id }, data: { role: 'editor' } });

  const response = await putSeo(app, cookie, { site_title: 'New Title' });
  expect(response.status).toBe(403);
  expect((await errorBody(response)).error.code).toBe('unauthorized');
});

test('PUT /api/v1/site/seo without a session returns 401', async () => {
  const app = createApp(async () => {});

  expect((await putSeo(app, '', { site_title: 'New Title' })).status).toBe(401);
});

test('GET /api/v1/site/appearance returns default sage preset', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);

  const response = await getAppearance(app, cookie);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    preset: 'sage',
    accent: null,
    mark: null,
    font: null,
    radius: null,
  });
});

test('PUT /api/v1/site/appearance allows sage', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);

  const response = await putAppearance(app, cookie, 'sage');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    preset: 'sage',
    accent: null,
    mark: null,
    font: null,
    radius: null,
  });

  const getRes = await getAppearance(app, cookie);
  expect(await getRes.json()).toEqual({
    preset: 'sage',
    accent: null,
    mark: null,
    font: null,
    radius: null,
  });
});

test('PUT /api/v1/site/appearance validates preset name', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);

  const response = await putAppearance(app, cookie, 'neon');
  expect(response.status).toBe(422);
  expect((await errorBody(response)).error.code).toBe('validation_failed');
});

test('PUT /api/v1/site/appearance validates hex color for accent and mark', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);

  const badAccent = await putAppearanceBody(app, cookie, { preset: 'sage', accent: 'not-hex' });
  expect(badAccent.status).toBe(422);
  expect((await errorBody(badAccent)).error.code).toBe('validation_failed');

  const badMark = await putAppearanceBody(app, cookie, { preset: 'sage', mark: '#123' });
  expect(badMark.status).toBe(422);
  expect((await errorBody(badMark)).error.code).toBe('validation_failed');
});

test('PUT /api/v1/site/appearance validates font against allowed list', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);

  const badFont = await putAppearanceBody(app, cookie, { preset: 'sage', font: 'Comic Sans' });
  expect(badFont.status).toBe(422);
  expect((await errorBody(badFont)).error.code).toBe('validation_failed');
});

test('PUT /api/v1/site/appearance validates radius range (0 to 20)', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);

  const negative = await putAppearanceBody(app, cookie, { preset: 'sage', radius: -1 });
  expect(negative.status).toBe(422);
  expect((await errorBody(negative)).error.code).toBe('validation_failed');

  const tooLarge = await putAppearanceBody(app, cookie, { preset: 'sage', radius: 21 });
  expect(tooLarge.status).toBe(422);
  expect((await errorBody(tooLarge)).error.code).toBe('validation_failed');

  const nonInteger = await putAppearanceBody(app, cookie, { preset: 'sage', radius: 10.5 });
  expect(nonInteger.status).toBe(422);
  expect((await errorBody(nonInteger)).error.code).toBe('validation_failed');
});

test('PUT /api/v1/site/appearance saves, persists, and resets custom branding', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);

  const saveRes = await putAppearanceBody(app, cookie, {
    preset: 'atlas',
    accent: '#6B2FBF',
    mark: '#FFD54A',
    font: 'DM Sans',
    radius: 10,
  });
  expect(saveRes.status).toBe(200);
  expect(await saveRes.json()).toEqual({
    preset: 'atlas',
    accent: '#6B2FBF',
    mark: '#FFD54A',
    font: 'DM Sans',
    radius: 10,
  });

  const getRes = await getAppearance(app, cookie);
  expect(await getRes.json()).toEqual({
    preset: 'atlas',
    accent: '#6B2FBF',
    mark: '#FFD54A',
    font: 'DM Sans',
    radius: 10,
  });

  const siteRes = await getSite(app, cookie);
  const site = (await siteRes.json()) as {
    preset: string;
    accent: string | null;
    mark: string | null;
    font: string | null;
    radius: number | null;
  };
  expect(site.preset).toBe('atlas');
  expect(site.accent).toBe('#6B2FBF');
  expect(site.mark).toBe('#FFD54A');
  expect(site.font).toBe('DM Sans');
  expect(site.radius).toBe(10);

  // Clear custom branding by setting them to null
  const resetRes = await putAppearanceBody(app, cookie, {
    preset: 'sage',
    accent: null,
    mark: null,
    font: null,
    radius: null,
  });
  expect(resetRes.status).toBe(200);
  expect(await resetRes.json()).toEqual({
    preset: 'sage',
    accent: null,
    mark: null,
    font: null,
    radius: null,
  });

  const afterReset = await getAppearance(app, cookie);
  expect(await afterReset.json()).toEqual({
    preset: 'sage',
    accent: null,
    mark: null,
    font: null,
    radius: null,
  });
});

test('a non-owner/admin member cannot change appearance', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  const organization = await prisma.organization.findFirstOrThrow();
  const owner = await prisma.member.findFirstOrThrow({ where: { organizationId: organization.id } });
  await prisma.member.update({ where: { id: owner.id }, data: { role: 'editor' } });

  const response = await putAppearance(app, cookie, 'sage');
  expect(response.status).toBe(403);
  expect((await errorBody(response)).error.code).toBe('unauthorized');
});

test('PUT /api/v1/site/appearance without a session returns 401', async () => {
  const app = createApp(async () => {});

  expect((await putAppearance(app, '', 'sage')).status).toBe(401);
});

test('PUT /api/v1/site/appearance lets the owner pick atlas and ledger with no plan gating', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);

  for (const preset of ['atlas', 'ledger']) {
    const response = await putAppearance(app, cookie, preset);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { preset: string }).preset).toBe(preset);
  }
});

test('an admin can set custom branding', async () => {
  const app = createApp(async () => {});
  await signIn(app);
  const cookie = await signIn(app, { ...OTHER_GITHUB_ACCOUNT, email: 'admin@example.com' });

  const response = await putAppearanceBody(app, cookie, { preset: 'atlas', accent: '#6B2FBF' });
  expect(response.status).toBe(200);
  expect(((await response.json()) as { accent: string }).accent).toBe('#6B2FBF');
});

test('an editor cannot set custom branding', async () => {
  const app = createApp(async () => {});
  await signIn(app);
  const cookie = await signIn(app, OTHER_GITHUB_ACCOUNT);

  const response = await putAppearanceBody(app, cookie, { preset: 'sage', accent: '#6B2FBF' });
  expect(response.status).toBe(403);
});

test('organization endpoints other than reads are refused through Better-Auth', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);

  for (const path of ['create', 'invite-member', 'set-active']) {
    const response = await app.handle(
      new Request(`${BASE_URL}/api/auth/organization/${path}`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Second', slug: 'second', email: 'x@example.com', role: 'editor' }),
      }),
    );
    expect(response.status).toBe(404);
  }
  expect(await prisma.organization.count()).toBe(1);
});
