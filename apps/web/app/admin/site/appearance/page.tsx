import { getAdminCategories, getMe, getSite } from '@/lib/server-api';
import { normalizeRole } from '@/lib/admin-nav';
import { AppearanceForm } from './appearance-form';

export const metadata = { title: 'Appearance — OpenDocs' };

export default async function AppearancePage() {
  const [me, site, categoriesRes] = await Promise.all([
    getMe(),
    getSite(),
    getAdminCategories(),
  ]);
  const role = normalizeRole(me?.role);
  const isEditorOnly = role === 'editor';

  return (
    <div className="stack">
      {!site ? (
        <>
          <div className="adm-pane-header">
            <div>
              <h1>Appearance</h1>
              <div>Choose how your public site looks</div>
            </div>
          </div>
          <p role="alert">Could not load site information. Refresh the page to try again.</p>
        </>
      ) : isEditorOnly ? (
        <>
          <div className="adm-pane-header">
            <div>
              <h1>Appearance</h1>
              <div>Choose how your public site looks</div>
            </div>
          </div>
          <div className="card">
            <p>
              <strong>Only owners and admins can change appearance settings.</strong>
            </p>
          </div>
        </>
      ) : (
        <AppearanceForm
          initial={site}
          categories={categoriesRes?.categories ?? []}
        />
      )}
    </div>
  );
}
