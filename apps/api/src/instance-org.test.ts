import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import {
  cleanDatabase,
  GITHUB_ACCOUNT,
  OTHER_GITHUB_ACCOUNT,
  realFetch,
  signIn,
} from '../test/helpers';
import { restoreEnv, setEnv } from '../test/env';
import { getPrisma } from './db';
import { createApp } from './index';
import { getInstanceOrg, INSTANCE_ORG_SLUG, syncMemberRole } from './instance-org';

const prisma = getPrisma();

beforeEach(async () => {
  await cleanDatabase();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  restoreEnv();
});

afterAll(async () => {
  await cleanDatabase();
});

const roleOf = async (email: string) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const member = await prisma.member.findFirstOrThrow({ where: { userId: user.id } });
  return member.role;
};

test('creates one org on first call', async () => {
  setEnv({ SITE_NAME: 'Example Docs' });
  expect(await prisma.organization.count()).toBe(0);

  const org = await getInstanceOrg();

  expect(org.slug).toBe(INSTANCE_ORG_SLUG);
  expect(org.name).toBe('Example Docs');
  expect(await prisma.organization.count()).toBe(1);
  expect((await getInstanceOrg()).id).toBe(org.id);
});

test('concurrent calls make one org', async () => {
  const orgs = await Promise.all(Array.from({ length: 12 }, () => getInstanceOrg()));

  expect(new Set(orgs.map((org) => org.id)).size).toBe(1);
  expect(await prisma.organization.count()).toBe(1);
});

test('first user is owner and gets no personal org', async () => {
  const app = createApp(async () => {});
  await signIn(app);

  expect(await prisma.organization.count()).toBe(1);
  expect(await prisma.member.count()).toBe(1);
  expect(await roleOf(GITHUB_ACCOUNT.email!)).toBe('owner');
});

test('later user joins as editor', async () => {
  const app = createApp(async () => {});
  await signIn(app);
  await signIn(app, OTHER_GITHUB_ACCOUNT);

  expect(await prisma.organization.count()).toBe(1);
  expect(await prisma.member.count()).toBe(2);
  expect(await roleOf(OTHER_GITHUB_ACCOUNT.email!)).toBe('editor');
});

test('simultaneous first sign-ins make exactly one owner', async () => {
  const app = createApp(async () => {});
  const accounts = [GITHUB_ACCOUNT, OTHER_GITHUB_ACCOUNT, { ...OTHER_GITHUB_ACCOUNT, id: 9191, login: 'third', email: 'third@example.com' }];
  // Sign-ins stub the global fetch, so run them one after another but join concurrently via the helper.
  for (const account of accounts) await signIn(app, account);

  const roles = (await prisma.member.findMany()).map((member) => member.role).sort();
  expect(roles).toEqual(['editor', 'editor', 'owner']);
});

test('the session starts in the instance workspace', async () => {
  const app = createApp(async () => {});
  await signIn(app);

  const org = await getInstanceOrg();
  const session = await prisma.session.findFirstOrThrow();
  expect(session.activeOrganizationId).toBe(org.id);
});

test('a later ADMIN_EMAILS change applies at the next sign-in, and never touches the owner', async () => {
  const app = createApp(async () => {});
  await signIn(app);
  await signIn(app, OTHER_GITHUB_ACCOUNT);
  expect(await roleOf(OTHER_GITHUB_ACCOUNT.email!)).toBe('editor');

  setEnv({ ADMIN_EMAILS: `${OTHER_GITHUB_ACCOUNT.email}` });
  await signIn(app, OTHER_GITHUB_ACCOUNT);
  expect(await roleOf(OTHER_GITHUB_ACCOUNT.email!)).toBe('admin');

  setEnv({ ADMIN_EMAILS: 'someone-else@example.com' });
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: GITHUB_ACCOUNT.email! } });
  await syncMemberRole(owner);
  expect(await roleOf(GITHUB_ACCOUNT.email!)).toBe('owner');

  await signIn(app, OTHER_GITHUB_ACCOUNT);
  expect(await roleOf(OTHER_GITHUB_ACCOUNT.email!)).toBe('editor');
});
