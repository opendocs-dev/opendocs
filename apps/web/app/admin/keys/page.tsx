import { getSession } from '@/lib/server-api';

import { KeysManager } from './keys-manager';

export const metadata = { title: 'API keys and MCP — OpenDocs' };

export default async function KeysPage() {
  // The layout already redirected unauthenticated visitors and blocked
  // sessions without a workspace, so the id is present here.
  const session = await getSession();
  const organizationId = session?.session.activeOrganizationId;

  if (!organizationId) {
    return (
      <div className="stack">
        <p role="alert">No workspace found — try signing in again</p>
      </div>
    );
  }

  return <KeysManager organizationId={organizationId} />;
}
