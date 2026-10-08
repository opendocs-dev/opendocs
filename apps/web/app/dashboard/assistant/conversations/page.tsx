import Link from 'next/link';
import { normalizeRole } from '@/lib/admin-nav';
import {
  getAssistantConversations,
  getAssistantGaps,
  getAssistantStats,
  getGuideList,
  getMe,
  getPlanInfo,
} from '@/lib/server-api';
import { ConversationsManager } from './conversations-manager';

export const metadata = { title: 'Conversations — OpenDocs' };

export default async function ConversationsPage() {
  const [me, planInfo, guidesRes] = await Promise.all([
    getMe(),
    getPlanInfo(),
    getGuideList({ limit: 100 }),
  ]);

  const role = normalizeRole(me?.role);
  const isOwnerOrAdmin = role === 'owner' || role === 'admin';
  const plan = planInfo?.plan ?? 'free';
  const isFree = plan === 'free';

  if (!isOwnerOrAdmin) {
    return (
      <div className="stack" style={{ gap: 20 }}>
        <div className="adm-pane-header">
          <div>
            <h1>Conversations and content gaps</h1>
            <div>Review reader questions and missing content</div>
          </div>
        </div>
        <div className="card">
          <p>
            <strong>Only owners and admins can view conversations.</strong>
          </p>
        </div>
      </div>
    );
  }

  if (isFree) {
    return (
      <div className="stack" style={{ gap: 20 }}>
        <div className="adm-pane-header">
          <div>
            <h1>Conversations and content gaps</h1>
            <div>Review reader questions and missing content</div>
          </div>
        </div>
        <div className="card-lock is-locked">
          <div className="card-veil">
            <div className="card-veil-box">
              <span className="badge badge-ai" style={{ marginBottom: 8 }}>
                Pro
              </span>
              <p>
                <b>Conversations and content gaps are on Pro</b>
              </p>
              <p className="sub" style={{ margin: '6px 0 16px' }}>
                Review what your readers ask and discover guides you need to write.
              </p>
              <Link href="/dashboard/plan" className="btn btn-primary">
                See plans
              </Link>
            </div>
          </div>

          {/* Background preview skeleton */}
          <div className="stack" style={{ gap: 16 }}>
            <div
              className="grid5"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: 12,
              }}
            >
              <div className="stat">
                <b>312</b>
                <span>Questions</span>
              </div>
              <div className="stat">
                <b>86%</b>
                <span>Answered from guides</span>
              </div>
              <div className="stat">
                <b>91%</b>
                <span>Rated helpful</span>
              </div>
              <div className="stat">
                <b>3</b>
                <span>Content gaps</span>
              </div>
              <div className="stat">
                <b>410</b>
                <span>Credits used</span>
              </div>
            </div>
            <div className="card">
              <div className="btns" role="tablist">
                <button type="button" className="btn btn-primary">Content gaps</button>
                <button type="button" className="btn">Questions</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const [stats, gapsRes, convosRes] = await Promise.all([
    getAssistantStats(30),
    getAssistantGaps('open'),
    getAssistantConversations(30),
  ]);

  if (!stats || !gapsRes || !convosRes) {
    return (
      <div className="stack" style={{ gap: 20 }}>
        <div className="adm-pane-header">
          <div>
            <h1>Conversations and content gaps</h1>
            <div>Review reader questions and missing content</div>
          </div>
        </div>
        <div className="card">
          <p role="alert">Could not load conversations. Refresh the page to try again.</p>
        </div>
      </div>
    );
  }

  return (
    <ConversationsManager
      initialStats={stats}
      initialGaps={gapsRes.gaps}
      initialConversations={convosRes.conversations}
      guides={guidesRes?.items ?? []}
      plan={plan}
    />
  );
}
