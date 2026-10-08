import Link from 'next/link';
import { getPlatformReservedNames } from '@/lib/server-api';
import { ReservedNamesManager } from './reserved-names-manager';

export const metadata = { title: 'Reserved names — OpenDocs' };

export default async function ReservedNamesPage() {
  const { reservedNames } = await getPlatformReservedNames();

  if (!reservedNames) {
    return (
      <div className="stack">
        <div className="adm-pane-header">
          <div>
            <h1>Reserved names</h1>
            <div className="sub">Names no workspace may claim as its address.</div>
          </div>
        </div>
        <p role="alert">
          Could not load reserved names. <Link href="/platform/reserved-names">Retry</Link>
        </p>
      </div>
    );
  }

  return <ReservedNamesManager reservedNames={reservedNames} />;
}
