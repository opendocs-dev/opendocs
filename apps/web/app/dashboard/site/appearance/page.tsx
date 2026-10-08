import { getAdminCategories, getMe, getPlanInfo, getSite } from '@/lib/server-api';
import { normalizeRole } from '@/lib/admin-nav';
import { AppearanceForm } from './appearance-form';

export const metadata = { title: 'Appearance — OpenDocs' };

export default async function AppearancePage() {
  const [me, site, planInfo, categoriesRes] = await Promise.all([
    getMe(),
    getSite(),
    getPlanInfo(),
    getAdminCategories(),
  ]);
  const role = normalizeRole(me?.role);
  const isEditorOnly = role === 'editor';
  const homeUrl = site?.address.host ? `https://${site.address.host}/` : '/';

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
          plan={planInfo?.plan ?? 'free'}
          homeUrl={homeUrl}
          categories={categoriesRes?.categories ?? []}
        />
      )}
    </div>
  );
}
