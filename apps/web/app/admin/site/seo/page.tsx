import { headers } from 'next/headers';

import { getMe, getSite } from '@/lib/server-api';
import { siteOrigin } from '@/lib/site-url';
import { normalizeRole } from '@/lib/admin-nav';
import { SeoForm } from './seo-form';

export const metadata = { title: 'SEO — OpenDocs' };

export default async function SeoPage() {
  const [me, site] = await Promise.all([getMe(), getSite()]);
  const role = normalizeRole(me?.role);
  const isEditorOnly = role === 'editor';
  const origin = siteOrigin(await headers());

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
        <SeoForm initial={site} homeUrl={`${origin}/`} />
      )}
    </div>
  );
}
