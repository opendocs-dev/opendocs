import { getMe, getStorage } from '@/lib/server-api';
import { normalizeRole } from '@/lib/admin-nav';
import { StorageManager } from './storage-manager';

export const metadata = { title: 'Storage — OpenDocs' };

export default async function StoragePage() {
  const [me, storage] = await Promise.all([getMe(), getStorage()]);
  const role = normalizeRole(me?.role);
  const isEditorOnly = role === 'editor';

  return (
    <div className="stack">
      {isEditorOnly ? (
        <>
          <div className="adm-pane-header">
            <div>
              <h1>Storage</h1>
              <div>Choose where your guide images live</div>
            </div>
          </div>
          <div className="card">
            <p>
              <strong>Only owners and admins can manage storage.</strong>
            </p>
          </div>
        </>
      ) : !storage ? (
        <>
          <div className="adm-pane-header">
            <div>
              <h1>Storage</h1>
              <div>Choose where your guide images live</div>
            </div>
          </div>
          <p role="alert">Could not load storage information. Refresh the page to try again.</p>
        </>
      ) : (
        <StorageManager initial={storage} />
      )}
    </div>
  );
}
