import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import {
  BASE_URL,
  cleanDatabase,
  memoryStorage,
  realFetch,
  signIn,
  type App,
} from '../../test/helpers';
import { getPrisma } from '../db';
import { createApp } from '../index';
import { getInstanceOrg } from '../instance-org';

const prisma = getPrisma();

type Workspace = {
  app: App;
  cookie: string;
  apiKey: string;
  organizationId: string;
};

const newApp = async (): Promise<App> => createApp(async () => {}, memoryStorage());

const workspace = async (app: App, account: Parameters<typeof signIn>[1] = {}): Promise<Workspace> => {
  const cookie = await signIn(app, account);

  const organizationId = (await getInstanceOrg()).id;

  const created = await app.handle(
    new Request(`${BASE_URL}/api/auth/api-key/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ organizationId, termsAccepted: true }),
    }),
  );
  expect(created.status).toBe(200);
  const key = (await created.json()) as { key: string };

  return {
    app,
    cookie,
    apiKey: key.key,
    organizationId,
  };
};

const errorCode = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

beforeEach(async () => {
  await cleanDatabase();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

afterAll(async () => {
  await cleanDatabase();
});

test('GET /api/v1/categories with session lists categories', async () => {
  const ws = await workspace(await newApp());

  await prisma.category.create({
    data: {
      organizationId: ws.organizationId,
      slug: 'whatsapp',
      name: 'WhatsApp',
      description: 'WhatsApp integration',
      source: 'user',
      status: 'active',
      position: 0,
    },
  });

  const response = await ws.app.handle(
    new Request(`${BASE_URL}/api/v1/categories`, {
      headers: { cookie: ws.cookie },
    }),
  );

  expect(response.status).toBe(200);
  const body = (await response.json()) as { categories: unknown[] };
  expect(body.categories).toHaveLength(1);
  expect(body.categories[0]).toMatchObject({
    id: expect.any(String),
    slug: 'whatsapp',
    name: 'WhatsApp',
    description: 'WhatsApp integration',
    status: 'active',
    guides: 0,
  });
});

test('GET /api/v1/categories with API key lists categories', async () => {
  const ws = await workspace(await newApp());

  await prisma.category.create({
    data: {
      organizationId: ws.organizationId,
      slug: 'email',
      name: 'Email',
      description: 'Email integration',
      source: 'user',
      status: 'active',
      position: 0,
    },
  });

  const response = await ws.app.handle(
    new Request(`${BASE_URL}/api/v1/categories`, {
      headers: { 'x-api-key': ws.apiKey },
    }),
  );

  expect(response.status).toBe(200);
  const body = (await response.json()) as { categories: unknown[] };
  expect(body.categories).toHaveLength(1);
  expect(body.categories[0]).toMatchObject({
    slug: 'email',
    name: 'Email',
  });
});

test('GET /api/v1/categories counts guides correctly', async () => {
  const ws = await workspace(await newApp());

  const category = await prisma.category.create({
    data: {
      organizationId: ws.organizationId,
      slug: 'whatsapp',
      name: 'WhatsApp',
      source: 'user',
      status: 'active',
    },
  });

  // Create flows in this category
  await prisma.flow.create({
    data: {
      publicId: 'flow-1',
      organizationId: ws.organizationId,
      title: 'Flow 1',
      categoryId: category.id,
    },
  });

  const response = await ws.app.handle(
    new Request(`${BASE_URL}/api/v1/categories`, {
      headers: { cookie: ws.cookie },
    }),
  );

  expect(response.status).toBe(200);
  const body = (await response.json()) as { categories: unknown[] };
  expect(body.categories[0]).toMatchObject({ guides: 1 });
});

test('POST /api/v1/categories creates a category', async () => {
  const ws = await workspace(await newApp());

  const response = await ws.app.handle(
    new Request(`${BASE_URL}/api/v1/categories`, {
      method: 'POST',
      headers: { cookie: ws.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'WhatsApp',
        description: 'WhatsApp integration guide',
      }),
    }),
  );

  expect(response.status).toBe(201);
  const body = (await response.json()) as {
    id: string;
    slug: string;
    name: string;
    description: string;
    status: string;
    guides: number;
  };
  expect(body).toMatchObject({
    slug: 'whatsapp',
    name: 'WhatsApp',
    description: 'WhatsApp integration guide',
    status: 'active',
    guides: 0,
  });

  const created = await prisma.category.findUnique({ where: { id: body.id } });
  expect(created?.source).toBe('user');
});

test('POST /api/v1/categories with duplicate slug returns 409', async () => {
  const ws = await workspace(await newApp());

  await prisma.category.create({
    data: {
      organizationId: ws.organizationId,
      slug: 'whatsapp',
      name: 'WhatsApp',
      source: 'user',
      status: 'active',
    },
  });

  const response = await ws.app.handle(
    new Request(`${BASE_URL}/api/v1/categories`, {
      method: 'POST',
      headers: { cookie: ws.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'WhatsApp', description: '' }),
    }),
  );

  expect(response.status).toBe(409);
  expect(await errorCode(response)).toBe('validation_failed');
});

test('POST /api/v1/categories with symbol-only name returns 422', async () => {
  const ws = await workspace(await newApp());

  const response = await ws.app.handle(
    new Request(`${BASE_URL}/api/v1/categories`, {
      method: 'POST',
      headers: { cookie: ws.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: '!!!', description: '' }),
    }),
  );

  expect(response.status).toBe(422);
  expect(await errorCode(response)).toBe('validation_failed');
});

test('POST /api/v1/categories at cap (30) returns 422', async () => {
  const ws = await workspace(await newApp());

  // Seed 30 categories
  for (let i = 0; i < 30; i += 1) {
    await prisma.category.create({
      data: {
        organizationId: ws.organizationId,
        slug: `category-${i}`,
        name: `Category ${i}`,
        source: 'user',
        status: 'active',
      },
    });
  }

  const response = await ws.app.handle(
    new Request(`${BASE_URL}/api/v1/categories`, {
      method: 'POST',
      headers: { cookie: ws.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'New Category', description: '' }),
    }),
  );

  expect(response.status).toBe(422);
  expect(await errorCode(response)).toBe('validation_failed');
});

test('POST /api/v1/categories requires session (rejects API key)', async () => {
  const ws = await workspace(await newApp());

  const response = await ws.app.handle(
    new Request(`${BASE_URL}/api/v1/categories`, {
      method: 'POST',
      headers: { 'x-api-key': ws.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'WhatsApp', description: '' }),
    }),
  );

  expect(response.status).toBe(401);
  expect(await errorCode(response)).toBe('unauthorized');
});

test('PATCH /api/v1/categories/:id renames and keeps slug', async () => {
  const ws = await workspace(await newApp());

  const category = await prisma.category.create({
    data: {
      organizationId: ws.organizationId,
      slug: 'whatsapp',
      name: 'WhatsApp',
      source: 'user',
      status: 'active',
    },
  });

  const response = await ws.app.handle(
    new Request(`${BASE_URL}/api/v1/categories/${category.id}`, {
      method: 'PATCH',
      headers: { cookie: ws.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'WhatsApp Updated' }),
    }),
  );

  expect(response.status).toBe(200);
  const body = (await response.json()) as { slug: string; name: string };
  expect(body.slug).toBe('whatsapp');
  expect(body.name).toBe('WhatsApp Updated');
});

test('PATCH /api/v1/categories/:id accepts status "active"', async () => {
  const ws = await workspace(await newApp());

  const category = await prisma.category.create({
    data: {
      organizationId: ws.organizationId,
      slug: 'whatsapp',
      name: 'WhatsApp',
      source: 'agent',
      status: 'suggested',
    },
  });

  const response = await ws.app.handle(
    new Request(`${BASE_URL}/api/v1/categories/${category.id}`, {
      method: 'PATCH',
      headers: { cookie: ws.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    }),
  );

  expect(response.status).toBe(200);
  const body = (await response.json()) as { status: string };
  expect(body.status).toBe('active');
});

test('DELETE /api/v1/categories/:id removes it', async () => {
  const ws = await workspace(await newApp());

  const category = await prisma.category.create({
    data: {
      organizationId: ws.organizationId,
      slug: 'whatsapp',
      name: 'WhatsApp',
      source: 'user',
      status: 'active',
    },
  });

  const response = await ws.app.handle(
    new Request(`${BASE_URL}/api/v1/categories/${category.id}`, {
      method: 'DELETE',
      headers: { cookie: ws.cookie },
    }),
  );

  expect(response.status).toBe(200);
  const body = (await response.json()) as { ok: boolean };
  expect(body.ok).toBe(true);

  const deleted = await prisma.category.findUnique({ where: { id: category.id } });
  expect(deleted).toBeNull();
});

test('DELETE /api/v1/categories/:id leaves flows uncategorized', async () => {
  const ws = await workspace(await newApp());

  const category = await prisma.category.create({
    data: {
      organizationId: ws.organizationId,
      slug: 'whatsapp',
      name: 'WhatsApp',
      source: 'user',
      status: 'active',
    },
  });

  const flow = await prisma.flow.create({
    data: {
      publicId: 'flow-123',
      organizationId: ws.organizationId,
      title: 'My Flow',
      categoryId: category.id,
    },
  });

  const response = await ws.app.handle(
    new Request(`${BASE_URL}/api/v1/categories/${category.id}`, {
      method: 'DELETE',
      headers: { cookie: ws.cookie },
    }),
  );

  expect(response.status).toBe(200);

  const flowAfter = await prisma.flow.findUniqueOrThrow({ where: { id: flow.id } });
  expect(flowAfter.categoryId).toBeNull();
});

test('DELETE /api/v1/categories/:id requires session', async () => {
  const ws = await workspace(await newApp());

  const category = await prisma.category.create({
    data: {
      organizationId: ws.organizationId,
      slug: 'whatsapp',
      name: 'WhatsApp',
      source: 'user',
      status: 'active',
    },
  });

  const response = await ws.app.handle(
    new Request(`${BASE_URL}/api/v1/categories/${category.id}`, {
      method: 'DELETE',
      headers: { 'x-api-key': ws.apiKey },
    }),
  );

  expect(response.status).toBe(401);
});

test('PUT /api/v1/flows/:publicId/category sets category', async () => {
  const ws = await workspace(await newApp());

  const flow = await prisma.flow.create({
    data: {
      publicId: 'flow-123',
      organizationId: ws.organizationId,
      title: 'My Flow',
    },
  });

  const category = await prisma.category.create({
    data: {
      organizationId: ws.organizationId,
      slug: 'whatsapp',
      name: 'WhatsApp',
      source: 'user',
      status: 'active',
    },
  });

  const response = await ws.app.handle(
    new Request(`${BASE_URL}/api/v1/flows/${flow.publicId}/category`, {
      method: 'PUT',
      headers: { cookie: ws.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ category_id: category.id }),
    }),
  );

  expect(response.status).toBe(200);
  const body = (await response.json()) as { ok: boolean };
  expect(body.ok).toBe(true);

  const flowAfter = await prisma.flow.findUniqueOrThrow({ where: { id: flow.id } });
  expect(flowAfter.categoryId).toBe(category.id);
});

test('PUT /api/v1/flows/:publicId/category with null clears category', async () => {
  const ws = await workspace(await newApp());

  const category = await prisma.category.create({
    data: {
      organizationId: ws.organizationId,
      slug: 'whatsapp',
      name: 'WhatsApp',
      source: 'user',
      status: 'active',
    },
  });

  const flow = await prisma.flow.create({
    data: {
      publicId: 'flow-123',
      organizationId: ws.organizationId,
      title: 'My Flow',
      categoryId: category.id,
    },
  });

  const response = await ws.app.handle(
    new Request(`${BASE_URL}/api/v1/flows/${flow.publicId}/category`, {
      method: 'PUT',
      headers: { cookie: ws.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ category_id: null }),
    }),
  );

  expect(response.status).toBe(200);

  const flowAfter = await prisma.flow.findUniqueOrThrow({ where: { id: flow.id } });
  expect(flowAfter.categoryId).toBeNull();
});

test('PUT /api/v1/site/category-policy sets policy to auto', async () => {
  const ws = await workspace(await newApp());

  const response = await ws.app.handle(
    new Request(`${BASE_URL}/api/v1/site/category-policy`, {
      method: 'PUT',
      headers: { cookie: ws.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ policy: 'auto' }),
    }),
  );

  expect(response.status).toBe(200);
  const body = (await response.json()) as { policy: string };
  expect(body.policy).toBe('auto');

  const site = await prisma.siteSettings.findUniqueOrThrow({
    where: { organizationId: ws.organizationId },
  });
  expect(site.categoryPolicy).toBe('auto');
});

test('PUT /api/v1/site/category-policy sets policy to suggest', async () => {
  const ws = await workspace(await newApp());
  await prisma.siteSettings.create({
    data: { organizationId: ws.organizationId, siteTitle: 'Site', categoryPolicy: 'auto' },
  });

  const response = await ws.app.handle(
    new Request(`${BASE_URL}/api/v1/site/category-policy`, {
      method: 'PUT',
      headers: { cookie: ws.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ policy: 'suggest' }),
    }),
  );

  expect(response.status).toBe(200);

  const site = await prisma.siteSettings.findUniqueOrThrow({
    where: { organizationId: ws.organizationId },
  });
  expect(site.categoryPolicy).toBe('suggest');
});

test('PUT /api/v1/site/category-policy with bad value returns 422', async () => {
  const ws = await workspace(await newApp());

  const response = await ws.app.handle(
    new Request(`${BASE_URL}/api/v1/site/category-policy`, {
      method: 'PUT',
      headers: { cookie: ws.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ policy: 'invalid' }),
    }),
  );

  expect(response.status).toBe(422);
  expect(await errorCode(response)).toBe('validation_failed');
});

test('PUT /api/v1/site/category-policy requires owner or admin', async () => {
  const ws = await workspace(await newApp());

  // A member who is not Owner or Admin
  await prisma.member.updateMany({ where: { organizationId: ws.organizationId }, data: { role: 'member' } });

  const response = await ws.app.handle(
    new Request(`${BASE_URL}/api/v1/site/category-policy`, {
      method: 'PUT',
      headers: { cookie: ws.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ policy: 'auto' }),
    }),
  );

  expect(response.status).toBe(403);
});

test('deleting an organization removes its categories', async () => {
  const ws = await workspace(await newApp());

  await prisma.category.create({
    data: {
      organizationId: ws.organizationId,
      slug: 'whatsapp',
      name: 'WhatsApp',
      source: 'user',
      status: 'active',
    },
  });

  expect(
    await prisma.category.count({ where: { organizationId: ws.organizationId } }),
  ).toBe(1);

  await prisma.organization.delete({ where: { id: ws.organizationId } });

  expect(
    await prisma.category.count({ where: { organizationId: ws.organizationId } }),
  ).toBe(0);
});
