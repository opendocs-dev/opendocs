import { afterAll, beforeEach, expect, test } from 'bun:test';
import { BASE_URL, cleanDatabase, GITHUB_ACCOUNT, OTHER_GITHUB_ACCOUNT, realFetch, signIn } from '../../test/helpers';
import { getPrisma } from '../db';
import { createApp } from '../index';

const prisma = getPrisma();

beforeEach(cleanDatabase);
afterAll(cleanDatabase);

const post = (app: ReturnType<typeof createApp>, path: string, cookie: string, body: unknown) =>
  app.handle(
    new Request(`${BASE_URL}/api/auth/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    }),
  );

test('an invitation with role editor can be created and accepted, and /me reads editor', async () => {
  const app = createApp(async () => {});
  const ownerCookie = await signIn(app, GITHUB_ACCOUNT);
  const owner = await prisma.member.findFirstOrThrow({ where: { role: 'owner' } });

  const invite = await post(app, 'organization/invite-member', ownerCookie, {
    email: OTHER_GITHUB_ACCOUNT.email,
    role: 'editor',
    organizationId: owner.organizationId,
  });
  expect(invite.status).toBe(200);
  const invitation = await prisma.invitation.findFirstOrThrow({ where: { organizationId: owner.organizationId } });
  expect(invitation.role).toBe('editor');

  globalThis.fetch = realFetch;
  const guestCookie = await signIn(app, OTHER_GITHUB_ACCOUNT);
  const accept = await post(app, 'organization/accept-invitation', guestCookie, { invitationId: invitation.id });
  expect(accept.status).toBe(200);

  const member = await prisma.member.findFirstOrThrow({
    where: { organizationId: owner.organizationId, role: 'editor' },
  });
  expect(member.role).toBe('editor');

  const active = await post(app, 'organization/set-active', guestCookie, { organizationId: owner.organizationId });
  expect(active.status).toBe(200);
  const me = await app.handle(new Request(`${BASE_URL}/api/v1/me`, { headers: { cookie: guestCookie } }));
  expect(((await me.json()) as { role: string }).role).toBe('editor');
});
