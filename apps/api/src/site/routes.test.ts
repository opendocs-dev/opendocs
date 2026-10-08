import { afterAll, afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { BASE_URL, cleanDatabase, OTHER_GITHUB_ACCOUNT, realFetch, signIn, type App } from '../../test/helpers';
import { getPrisma } from '../db';

/**
 * CNAME lookups go through node:dns, mocked once for this whole file so the custom-domain
 * tests below never touch the network. `cnameAnswers` is read fresh on every lookup, so each
 * test can set up its own fake record without needing a separate mock per test.
 */
const cnameAnswers = new Map<string, string[]>();
mock.module('node:dns', () => ({
  default: {
    promises: {
      resolveCname: async (hostname: string) => {
        const answer = cnameAnswers.get(hostname);
        if (!answer) throw new Error('ENODATA');
        return answer;
      },
    },
  },
}));

// Dynamic import, not static: mock.module above must register before anything (routes.ts via
// domain.ts) imports node:dns for the first time, so the app can only be loaded after it.
const { createApp } = await import('../index');

const prisma = getPrisma();

const addressCheck = (app: App, cookie: string, slug: string) =>
  app.handle(
    new Request(`${BASE_URL}/api/v1/site/address-check?slug=${encodeURIComponent(slug)}`, {
      headers: { cookie },
    }),
  );

const getSite = (app: App, cookie: string) =>
  app.handle(new Request(`${BASE_URL}/api/v1/site`, { headers: { cookie } }));

const putAddress = (app: App, cookie: string, slug: string) =>
  app.handle(
    new Request(`${BASE_URL}/api/v1/site/address`, {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ slug }),
    }),
  );

const resolve = (app: App, slug: string) =>
  app.handle(new Request(`${BASE_URL}/api/v1/site/resolve?slug=${encodeURIComponent(slug)}`));

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
      provider: 'local',
      providerAccount: 'local',
      providerFileId: crypto.randomUUID(),
      mime: 'image/png',
      bytes: 100,
      width: 32,
      height: 32,
      sha256: 'a'.repeat(64),
      expiresAt: null,
    },
  });

const putCustomDomain = (app: App, cookie: string, domain: string | null) =>
  app.handle(
    new Request(`${BASE_URL}/api/v1/site/custom-domain`, {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ domain }),
    }),
  );

const recheckCustomDomain = (app: App, cookie: string) =>
  app.handle(
    new Request(`${BASE_URL}/api/v1/site/custom-domain/recheck`, {
      method: 'POST',
      headers: { cookie },
    }),
  );

const errorBody = async (response: Response) =>
  (await response.json()) as { error: { code: string; message: string } };

beforeEach(async () => {
  cnameAnswers.clear();
  await cleanDatabase();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

afterAll(async () => {
  await cleanDatabase();
});

test('address-check flags a reserved slug', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);

  const login = await addressCheck(app, cookie, 'login');
  expect(login.status).toBe(200);
  expect(await login.json()).toEqual({ status: 'reserved', reason: 'phishing' });

  const paypal = await addressCheck(app, cookie, 'paypal');
  expect(await paypal.json()).toEqual({ status: 'reserved', reason: 'phishing' });
});

test('address-check flags a taken slug', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  const other = await prisma.organization.create({
    data: { id: crypto.randomUUID(), name: 'Other', slug: 'other-workspace' },
  });

  const response = await addressCheck(app, cookie, 'other-workspace');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: 'taken' });
  expect(other.slug).toBe('other-workspace');
});

test('address-check reports an available slug', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);

  const response = await addressCheck(app, cookie, 'brand-new-name');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: 'available' });
});

test('address-check flags an invalid slug', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);

  const response = await addressCheck(app, cookie, 'ab');
  expect(response.status).toBe(200);
  const body = (await response.json()) as { status: string; reason: string };
  expect(body.status).toBe('invalid');
  expect(body.reason).toBeTruthy();
});

test('address-check without a session returns 401', async () => {
  const app = createApp(async () => {});

  const response = await addressCheck(app, '', 'brand-new-name');
  expect(response.status).toBe(401);
  expect((await errorBody(response)).error.code).toBe('unauthorized');
});

test('GET /api/v1/site upserts a workspace site and reports no host when unset', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);

  const response = await getSite(app, cookie);
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    address: { slug: string; host: string | null };
    site_title: string;
    tagline: string;
    preset: string;
    indexing: boolean;
    category_policy: string;
  };
  expect(body.address.host).toBeNull();
  expect(body.tagline).toBe('');
  expect(body.preset).toBe('sage');
  expect(body.indexing).toBe(true);
  expect(body.category_policy).toBe('suggest');

  const organization = await prisma.organization.findFirstOrThrow();
  expect(body.address.slug).toBe(organization.slug);
  expect(body.site_title).toBe(organization.name);

  const site = await prisma.workspaceSite.findUnique({ where: { organizationId: organization.id } });
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

test('a non-owner/admin member cannot change the address', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  const organization = await prisma.organization.findFirstOrThrow();
  const owner = await prisma.member.findFirstOrThrow({ where: { organizationId: organization.id } });

  await prisma.member.update({ where: { id: owner.id }, data: { role: 'member' } });

  const response = await putAddress(app, cookie, 'a-new-address');
  expect(response.status).toBe(403);
  expect((await errorBody(response)).error.code).toBe('unauthorized');
});

test('the owner can change the address, and the old one redirects', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  const organization = await prisma.organization.findFirstOrThrow();
  const oldSlug = organization.slug;

  const response = await putAddress(app, cookie, 'my-new-address');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ slug: 'my-new-address', host: null });

  const updated = await prisma.organization.findUniqueOrThrow({ where: { id: organization.id } });
  expect(updated.slug).toBe('my-new-address');

  const history = await prisma.siteAddressHistory.findUniqueOrThrow({ where: { slug: oldSlug } });
  expect(history.organizationId).toBe(organization.id);

  const oldResolve = await resolve(app, oldSlug);
  expect(await oldResolve.json()).toEqual({ status: 'redirect', slug: 'my-new-address' });

  const newResolve = await resolve(app, 'my-new-address');
  expect(await newResolve.json()).toEqual({ status: 'active' });
});

test('the same slug as current is a no-op', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  const organization = await prisma.organization.findFirstOrThrow();

  const response = await putAddress(app, cookie, organization.slug);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ slug: organization.slug, host: null });

  expect(await prisma.siteAddressHistory.count()).toBe(0);
});

test('a 4th address change in one UTC day is refused', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);

  expect((await putAddress(app, cookie, 'address-one')).status).toBe(200);
  expect((await putAddress(app, cookie, 'address-two')).status).toBe(200);
  expect((await putAddress(app, cookie, 'address-three')).status).toBe(200);

  const fourth = await putAddress(app, cookie, 'address-four');
  expect(fourth.status).toBe(429);
  expect((await errorBody(fourth)).error.code).toBe('quota_exceeded');
});

test('a slug retired 91 days ago is missing and claimable again', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  const organization = await prisma.organization.findFirstOrThrow();

  expect((await putAddress(app, cookie, 'freshly-retired')).status).toBe(200);
  const oldSlug = organization.slug;

  await prisma.siteAddressHistory.update({
    where: { slug: oldSlug },
    data: { retiredAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000) },
  });

  const stale = await resolve(app, oldSlug);
  expect(await stale.json()).toEqual({ status: 'missing' });

  const check = await addressCheck(app, cookie, oldSlug);
  expect(await check.json()).toEqual({ status: 'available' });
});

test('resolve never includes ids', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  const organization = await prisma.organization.findFirstOrThrow();

  const response = await resolve(app, organization.slug);
  const body = (await response.json()) as Record<string, unknown>;
  expect(JSON.stringify(body)).not.toContain(organization.id);
  expect(body).not.toHaveProperty('id');
  expect(body).not.toHaveProperty('organizationId');

  void cookie;
});

test('a suspended organization resolves missing, identical to an unknown slug', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  const organization = await prisma.organization.findFirstOrThrow();
  await prisma.organization.update({ where: { id: organization.id }, data: { suspendedAt: new Date() } });

  const suspended = await resolve(app, organization.slug);
  const unknown = await resolve(app, 'totally-unknown-slug');

  const suspendedBody = await suspended.json();
  const unknownBody = await unknown.json();
  expect(suspended.status).toBe(unknown.status);
  expect(suspendedBody).toEqual(unknownBody);
  expect(unknownBody).toEqual({ status: 'missing' });

  void cookie;
});

test('deleting an organization removes its WorkspaceSite and SiteAddressHistory rows', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  const organization = await prisma.organization.findFirstOrThrow();

  await getSite(app, cookie);
  expect((await putAddress(app, cookie, 'about-to-be-deleted')).status).toBe(200);

  expect(await prisma.workspaceSite.count({ where: { organizationId: organization.id } })).toBe(1);
  expect(await prisma.siteAddressHistory.count({ where: { organizationId: organization.id } })).toBe(1);

  await prisma.organization.delete({ where: { id: organization.id } });

  expect(await prisma.workspaceSite.count({ where: { organizationId: organization.id } })).toBe(0);
  expect(await prisma.siteAddressHistory.count({ where: { organizationId: organization.id } })).toBe(0);
});

test('toggling between two addresses still counts toward the daily limit', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  const current = ((await (await getSite(app, cookie)).json()) as { address: { slug: string } }).address.slug;

  expect((await putAddress(app, cookie, 'toggle-a')).status).toBe(200);
  expect((await putAddress(app, cookie, current)).status).toBe(200);
  expect((await putAddress(app, cookie, 'toggle-a')).status).toBe(200);
  const fourth = await putAddress(app, cookie, current);
  expect(fourth.status).toBe(429);
});

test('two workspaces claiming one free slug at once: one wins, the other gets 409, never 500', async () => {
  const app = createApp(async () => {});
  const one = await signIn(app);
  const two = await signIn(app, OTHER_GITHUB_ACCOUNT);

  const [a, b] = await Promise.all([putAddress(app, one, 'race-slug'), putAddress(app, two, 'race-slug')]);
  expect([a.status, b.status].sort()).toEqual([200, 409]);
});

test('GET /api/v1/site reports no custom domain by default', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);

  const response = await getSite(app, cookie);
  const body = (await response.json()) as {
    domain: { custom_domain: string | null; status: string | null; cname_target: string };
  };
  expect(body.domain.custom_domain).toBeNull();
  expect(body.domain.status).toBeNull();
});

test('setting a custom domain with a matching CNAME verifies on the first check', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  const organization = await prisma.organization.findFirstOrThrow();
  cnameAnswers.set('docs.example.com', [`${organization.slug}.opendocs.xxx`]);
  process.env.TENANT_BASE_DOMAIN = 'opendocs.xxx';

  const response = await putCustomDomain(app, cookie, 'docs.example.com');
  expect(response.status).toBe(200);
  const body = (await response.json()) as { custom_domain: string; status: string };
  expect(body.custom_domain).toBe('docs.example.com');
  expect(body.status).toBe('verified');

  const site = await prisma.workspaceSite.findUniqueOrThrow({ where: { organizationId: organization.id } });
  expect(site.customDomain).toBe('docs.example.com');
  expect(site.domainStatus).toBe('verified');
  expect(site.lastCheckedAt).not.toBeNull();

  delete process.env.TENANT_BASE_DOMAIN;
});

test('setting a custom domain with no matching CNAME waits for DNS', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  // No entry in cnameAnswers: the mock throws ENODATA, same as a real NXDOMAIN.

  const response = await putCustomDomain(app, cookie, 'docs.example.com');
  expect(response.status).toBe(200);
  const body = (await response.json()) as { status: string };
  expect(body.status).toBe('waiting_dns');

  const organization = await prisma.organization.findFirstOrThrow();
  const site = await prisma.workspaceSite.findUniqueOrThrow({ where: { organizationId: organization.id } });
  expect(site.domainStatus).toBe('waiting_dns');
});

test('clearing the custom domain resets customDomain, domainStatus and lastCheckedAt', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  const organization = await prisma.organization.findFirstOrThrow();
  cnameAnswers.set('docs.example.com', [`${organization.slug}.opendocs.xxx`]);
  process.env.TENANT_BASE_DOMAIN = 'opendocs.xxx';
  expect((await putCustomDomain(app, cookie, 'docs.example.com')).status).toBe(200);

  const response = await putCustomDomain(app, cookie, null);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { custom_domain: string | null; status: string | null };
  expect(body.custom_domain).toBeNull();
  expect(body.status).toBeNull();

  const site = await prisma.workspaceSite.findUniqueOrThrow({ where: { organizationId: organization.id } });
  expect(site.customDomain).toBeNull();
  expect(site.domainStatus).toBeNull();
  expect(site.lastCheckedAt).toBeNull();

  delete process.env.TENANT_BASE_DOMAIN;
});

test('recheck flips waiting_dns to verified once the CNAME appears', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  const organization = await prisma.organization.findFirstOrThrow();
  process.env.TENANT_BASE_DOMAIN = 'opendocs.xxx';

  expect((await putCustomDomain(app, cookie, 'docs.example.com')).status).toBe(200);
  let site = await prisma.workspaceSite.findUniqueOrThrow({ where: { organizationId: organization.id } });
  expect(site.domainStatus).toBe('waiting_dns');

  cnameAnswers.set('docs.example.com', [`${organization.slug}.opendocs.xxx`]);
  const response = await recheckCustomDomain(app, cookie);
  expect(response.status).toBe(200);
  expect(((await response.json()) as { status: string }).status).toBe('verified');

  site = await prisma.workspaceSite.findUniqueOrThrow({ where: { organizationId: organization.id } });
  expect(site.domainStatus).toBe('verified');

  delete process.env.TENANT_BASE_DOMAIN;
});

test('recheck flips verified back to waiting_dns once the CNAME is removed', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  const organization = await prisma.organization.findFirstOrThrow();
  process.env.TENANT_BASE_DOMAIN = 'opendocs.xxx';
  cnameAnswers.set('docs.example.com', [`${organization.slug}.opendocs.xxx`]);

  expect((await putCustomDomain(app, cookie, 'docs.example.com')).status).toBe(200);
  let site = await prisma.workspaceSite.findUniqueOrThrow({ where: { organizationId: organization.id } });
  expect(site.domainStatus).toBe('verified');

  cnameAnswers.delete('docs.example.com');
  const response = await recheckCustomDomain(app, cookie);
  expect(response.status).toBe(200);
  expect(((await response.json()) as { status: string }).status).toBe('waiting_dns');

  site = await prisma.workspaceSite.findUniqueOrThrow({ where: { organizationId: organization.id } });
  expect(site.domainStatus).toBe('waiting_dns');

  delete process.env.TENANT_BASE_DOMAIN;
});

test('recheck with no custom domain set returns a validation error', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);

  const response = await recheckCustomDomain(app, cookie);
  expect(response.status).toBe(400);
  expect((await errorBody(response)).error.code).toBe('validation_failed');
});

test('setting a domain already claimed by another workspace returns 409', async () => {
  const app = createApp(async () => {});
  const first = await signIn(app);
  const second = await signIn(app, OTHER_GITHUB_ACCOUNT);

  expect((await putCustomDomain(app, first, 'docs.example.com')).status).toBe(200);

  const response = await putCustomDomain(app, second, 'docs.example.com');
  expect(response.status).toBe(409);
  expect((await errorBody(response)).error.code).toBe('validation_failed');
});

test('setting an invalid domain format is rejected', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);

  const response = await putCustomDomain(app, cookie, 'not a domain');
  expect(response.status).toBe(400);
  expect((await errorBody(response)).error.code).toBe('validation_failed');
});

test('a non-owner/admin member cannot set the custom domain', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  const organization = await prisma.organization.findFirstOrThrow();
  const owner = await prisma.member.findFirstOrThrow({ where: { organizationId: organization.id } });
  await prisma.member.update({ where: { id: owner.id }, data: { role: 'editor' } });

  const response = await putCustomDomain(app, cookie, 'docs.example.com');
  expect(response.status).toBe(403);
  expect((await errorBody(response)).error.code).toBe('unauthorized');
});

test('custom-domain routes without a session return 401', async () => {
  const app = createApp(async () => {});

  expect((await putCustomDomain(app, '', 'docs.example.com')).status).toBe(401);
  expect((await recheckCustomDomain(app, '')).status).toBe(401);
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
  expect(body.favicon_url).toBe(`${process.env.ASSET_BASE_URL}/i/${favicon.publicId}`);
  expect(body.og_image_url).toBe(`${process.env.ASSET_BASE_URL}/i/${og.publicId}`);
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
      provider: 'local',
      providerAccount: 'local',
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

test('PUT /api/v1/site/seo rejects a brand asset owned by another workspace', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  const other = await prisma.organization.create({
    data: { id: crypto.randomUUID(), name: 'Other', slug: 'other-brand-owner' },
  });
  const theirAsset = await seedBrandAsset(other.id);

  const response = await putSeo(app, cookie, { favicon_asset_id: theirAsset.id });
  expect(response.status).toBe(422);
});

test('PUT /api/v1/site/seo stores custom meta tags and reports them back', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  const organization = await prisma.organization.findFirstOrThrow();
  await prisma.workspaceBilling.create({
    data: { organizationId: organization.id, plan: 'enterprise' },
  });

  const response = await putSeo(app, cookie, {
    custom_meta: [{ name: 'theme-color', content: '#0f6b54' }],
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { custom_meta: { name: string; content: string }[] };
  expect(body.custom_meta).toEqual([{ name: 'theme-color', content: '#0f6b54' }]);
});

test('PUT /api/v1/site/seo blocks custom meta tags on free and pro plans', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);

  const freeResponse = await putSeo(app, cookie, {
    custom_meta: [{ name: 'theme-color', content: '#0f6b54' }],
  });
  expect(freeResponse.status).toBe(403);
  expect((await errorBody(freeResponse)).error.code).toBe('unauthorized');

  const organization = await prisma.organization.findFirstOrThrow();
  await prisma.workspaceBilling.create({
    data: { organizationId: organization.id, plan: 'pro' },
  });

  const proResponse = await putSeo(app, cookie, {
    custom_meta: [{ name: 'theme-color', content: '#0f6b54' }],
  });
  expect(proResponse.status).toBe(403);
  expect((await errorBody(proResponse)).error.code).toBe('unauthorized');
});

test('PUT /api/v1/site/seo rejects custom meta content containing "<" or ">"', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  const organization = await prisma.organization.findFirstOrThrow();
  await prisma.workspaceBilling.create({
    data: { organizationId: organization.id, plan: 'enterprise' },
  });

  const response = await putSeo(app, cookie, {
    custom_meta: [{ name: 'bad', content: '<script>alert(1)</script>' }],
  });
  expect(response.status).toBe(422);
  expect((await errorBody(response)).error.code).toBe('validation_failed');

  const site = await prisma.workspaceSite.findFirst();
  expect(site).toBeNull();
});

test('PUT /api/v1/site/seo rejects more than 10 custom meta tags', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  const organization = await prisma.organization.findFirstOrThrow();
  await prisma.workspaceBilling.create({
    data: { organizationId: organization.id, plan: 'enterprise' },
  });

  const response = await putSeo(app, cookie, {
    custom_meta: Array.from({ length: 11 }, (_, i) => ({ name: `tag-${i}`, content: 'x' })),
  });
  expect(response.status).toBe(422);
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

test('PUT /api/v1/site/appearance allows sage on free plan', async () => {
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

test('PUT /api/v1/site/appearance blocks atlas and ledger on free plan', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);

  const atlasRes = await putAppearance(app, cookie, 'atlas');
  expect(atlasRes.status).toBe(403);
  const atlasErr = await errorBody(atlasRes);
  expect(atlasErr.error.code).toBe('unauthorized');
  expect(atlasErr.error.message).toContain('Pro or Enterprise');

  const ledgerRes = await putAppearance(app, cookie, 'ledger');
  expect(ledgerRes.status).toBe(403);
  const ledgerErr = await errorBody(ledgerRes);
  expect(ledgerErr.error.code).toBe('unauthorized');
  expect(ledgerErr.error.message).toContain('Pro or Enterprise');
});

test('PUT /api/v1/site/appearance validates preset name', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);

  const response = await putAppearance(app, cookie, 'neon');
  expect(response.status).toBe(422);
  expect((await errorBody(response)).error.code).toBe('validation_failed');
});

test('PUT /api/v1/site/appearance allows atlas on pro plan', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  const organization = await prisma.organization.findFirstOrThrow();

  await prisma.workspaceBilling.create({
    data: { organizationId: organization.id, plan: 'pro' },
  });

  const response = await putAppearance(app, cookie, 'atlas');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    preset: 'atlas',
    accent: null,
    mark: null,
    font: null,
    radius: null,
  });

  const siteRes = await getSite(app, cookie);
  const site = (await siteRes.json()) as { preset: string };
  expect(site.preset).toBe('atlas');
});

test('PUT /api/v1/site/appearance allows ledger on enterprise plan', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  const organization = await prisma.organization.findFirstOrThrow();

  await prisma.workspaceBilling.create({
    data: { organizationId: organization.id, plan: 'enterprise' },
  });

  const response = await putAppearance(app, cookie, 'ledger');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    preset: 'ledger',
    accent: null,
    mark: null,
    font: null,
    radius: null,
  });

  const siteRes = await getSite(app, cookie);
  const site = (await siteRes.json()) as { preset: string };
  expect(site.preset).toBe('ledger');
});

test('PUT /api/v1/site/appearance validates hex color for accent and mark', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  const organization = await prisma.organization.findFirstOrThrow();
  await prisma.workspaceBilling.create({
    data: { organizationId: organization.id, plan: 'enterprise' },
  });

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
  const organization = await prisma.organization.findFirstOrThrow();
  await prisma.workspaceBilling.create({
    data: { organizationId: organization.id, plan: 'enterprise' },
  });

  const badFont = await putAppearanceBody(app, cookie, { preset: 'sage', font: 'Comic Sans' });
  expect(badFont.status).toBe(422);
  expect((await errorBody(badFont)).error.code).toBe('validation_failed');
});

test('PUT /api/v1/site/appearance validates radius range (0 to 20)', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  const organization = await prisma.organization.findFirstOrThrow();
  await prisma.workspaceBilling.create({
    data: { organizationId: organization.id, plan: 'enterprise' },
  });

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

test('PUT /api/v1/site/appearance blocks custom branding on free and pro plans', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);

  const freeRes = await putAppearanceBody(app, cookie, { preset: 'sage', accent: '#6B2FBF' });
  expect(freeRes.status).toBe(403);
  const freeErr = await errorBody(freeRes);
  expect(freeErr.error.code).toBe('unauthorized');
  expect(freeErr.error.message).toContain('Enterprise');

  const organization = await prisma.organization.findFirstOrThrow();
  await prisma.workspaceBilling.create({
    data: { organizationId: organization.id, plan: 'pro' },
  });

  const proRes = await putAppearanceBody(app, cookie, { preset: 'atlas', mark: '#FFD54A' });
  expect(proRes.status).toBe(403);
  const proErr = await errorBody(proRes);
  expect(proErr.error.code).toBe('unauthorized');
  expect(proErr.error.message).toContain('Enterprise');
});

test('PUT /api/v1/site/appearance saves, persists, and resets custom branding on enterprise plan', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  const organization = await prisma.organization.findFirstOrThrow();
  await prisma.workspaceBilling.create({
    data: { organizationId: organization.id, plan: 'enterprise' },
  });

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
