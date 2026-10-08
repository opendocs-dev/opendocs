import { getMe, getPlanInfo, getSite } from '@/lib/server-api';
import { normalizeRole } from '@/lib/admin-nav';
import { SeoForm } from './seo-form';

export const metadata = { title: 'SEO — OpenDocs' };

export default async function SeoPage() {
  const [me, site, planInfo] = await Promise.all([getMe(), getSite(), getPlanInfo()]);
  const role = normalizeRole(me?.role);
  const isEditorOnly = role === 'editor';
  const isEnterprise =
    (planInfo?.plans.find((entry) => entry.plan === planInfo.plan)?.capabilities.customDomain ?? false) ||
    planInfo?.plan === 'enterprise' ||
    me?.plan === 'enterprise';
  const host =
    site?.address.host ||
    (site?.address.slug ? `${site.address.slug}.opendocs.xxx` : 'acme.opendocs.xxx');
  const homeUrl = `https://${host}/`;

  return (
    <div className="stack">
      {!site ? (
        <>
          <div className="adm-pane-header">
            <div>
              <h1>SEO</h1>
              <div>Control how search engines and social apps show your site</div>
            </div>
          </div>
          <p role="alert">Could not load site information. Refresh the page to try again.</p>
        </>
      ) : isEditorOnly ? (
        <>
          <div className="adm-pane-header">
            <div>
              <h1>SEO</h1>
              <div>Control how search engines and social apps show your site</div>
            </div>
          </div>
          <div className="card">
            <p>
              <strong>Only owners and admins can change site settings.</strong>
            </p>
          </div>
        </>
      ) : (
        <SeoForm initial={site} homeUrl={homeUrl} isEnterprise={isEnterprise} />
      )}
    </div>
  );
}
