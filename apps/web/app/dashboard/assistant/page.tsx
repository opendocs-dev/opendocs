import Link from 'next/link';
import { normalizeRole } from '@/lib/admin-nav';
import {
  getAdminCategories,
  getAssistant,
  getGuideList,
  getMe,
  getPlanInfo,
  getSite,
} from '@/lib/server-api';
import { AssistantManager } from './assistant-manager';

export const metadata = { title: 'AI Assistant — OpenDocs' };

export default async function AssistantPage() {
  const [me, planInfo, site, categoriesRes, guidesRes] = await Promise.all([
    getMe(),
    getPlanInfo(),
    getSite(),
    getAdminCategories(),
    getGuideList({ limit: 100 }),
  ]);

  const role = normalizeRole(me?.role);
  const isOwnerOrAdmin = role === 'owner' || role === 'admin';
  const plan = planInfo?.plan ?? 'free';
  const isFree = plan === 'free';
  const sitePreset = site?.preset ?? 'sage';
  const siteHost = site?.address?.host ?? 'yourdomain.com';

  const assistantData = !isFree && isOwnerOrAdmin ? await getAssistant() : null;

  return (
    <div className="stack" style={{ gap: 20 }}>
      {!isOwnerOrAdmin ? (
        <>
          <div className="adm-pane-header">
            <div>
              <h1>AI assistant</h1>
              <div>Configure how your assistant answers readers</div>
            </div>
          </div>
          <div className="card">
            <p>
              <strong>Only owners and admins can manage the AI assistant.</strong>
            </p>
          </div>
        </>
      ) : isFree ? (
        <>
          <div className="adm-pane-header">
            <div>
              <h1>AI assistant</h1>
              <div>Configure how your assistant answers readers</div>
            </div>
          </div>
          <div className="card-lock is-locked">
            <div className="card-veil">
              <div className="card-veil-box">
                <span className="badge badge-ai" style={{ marginBottom: 8 }}>
                  Pro
                </span>
                <p>
                  <b>The AI assistant is on Pro</b>
                </p>
                <p className="sub" style={{ margin: '6px 0 16px' }}>
                  Let readers ask questions and get answers from your guides.
                </p>
                <Link href="/dashboard/plan" className="btn btn-primary">
                  See plans
                </Link>
              </div>
            </div>

            {/* Inactive background mockup to look like locked page in prototype */}
            <div className="stack" style={{ gap: 16 }}>
              <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <strong>Assistant is off</strong>
                  <div className="sub">0 of 0 credits used this month</div>
                </div>
              </div>
              <div className="card stack" style={{ gap: 16 }}>
                <div className="btns" role="tablist">
                  <button type="button" className="btn btn-primary">Setup</button>
                  <button type="button" className="btn">Knowledge</button>
                  <button type="button" className="btn">Behavior</button>
                  <button type="button" className="btn">Model and credits</button>
                  <button type="button" className="btn">Where it appears</button>
                </div>
                <div className="fld">
                  <label>Name</label>
                  <input type="text" disabled value="Acme Assistant" readOnly />
                </div>
              </div>
            </div>
          </div>
        </>
      ) : !assistantData ? (
        <div className="card">
          <p role="alert">Could not load AI assistant settings. Refresh the page to try again.</p>
        </div>
      ) : (
        <AssistantManager
          initial={assistantData}
          plan={plan}
          categories={categoriesRes?.categories ?? []}
          guides={guidesRes?.items ?? []}
          sitePreset={sitePreset}
          siteHost={siteHost}
        />
      )}
    </div>
  );
}
