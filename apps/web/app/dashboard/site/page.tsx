import { getMe, getPlanInfo, getSite } from '@/lib/server-api';
import { normalizeRole } from '@/lib/admin-nav';
import { formatAddressSuffix } from '@/lib/site-address';
import { CustomDomainForm } from './custom-domain-form';
import { SiteAddressForm } from './site-address-form';

export const metadata = { title: 'Domain — OpenDocs' };

export default async function SitePage() {
  const [me, site, planInfo] = await Promise.all([getMe(), getSite(), getPlanInfo()]);
  const role = normalizeRole(me?.role);
  const isEditorOnly = role === 'editor';
  const canUseCustomDomain =
    planInfo?.plans.find((entry) => entry.plan === planInfo.plan)?.capabilities.customDomain ?? false;

  return (
    <div className="stack">
      <div className="adm-pane-header">
        <div>
          <h1>Domain</h1>
          <div>Where people find your guides</div>
        </div>
      </div>

      {!site ? (
        <p role="alert">Could not load site information. Refresh the page to try again.</p>
      ) : isEditorOnly ? (
        <div className="card">
          <p>
            <strong>Only owners and admins can change the address.</strong>
          </p>
          {site.address.slug && (
            <p className="sub" style={{ marginTop: '12px' }}>
              Current address:{' '}
              <strong>
                {site.address.slug}
                {formatAddressSuffix(site.address.host)}
              </strong>
            </p>
          )}
          {site.domain.custom_domain && (
            <p className="sub" style={{ marginTop: '8px' }}>
              Custom domain: <strong>{site.domain.custom_domain}</strong>
            </p>
          )}
        </div>
      ) : (
        <>
          <SiteAddressForm
            current={site.address.slug}
            host={site.address.host}
          />
          <CustomDomainForm
            initial={site.domain}
            isEnterprise={canUseCustomDomain}
          />
        </>
      )}
    </div>
  );
}
