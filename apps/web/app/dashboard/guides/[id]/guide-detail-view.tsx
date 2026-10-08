'use client';

import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';
import type { AdminCategory, AdminStep, FlowItem, FlowRun } from '@/lib/server-api';
import { formatRecordedDate, formatRunDateTime } from '../../flows/flow-format';
import { GuideSettingsForm } from './guide-settings-form';
import { GuideStepsEditor } from './guide-steps-editor';

type Props = {
  guide: FlowItem;
  initialSteps: AdminStep[];
  categories: AdminCategory[];
  siteHost: string | null;
  siteName?: string | null;
  previewUrl?: string | null;
  defaultTab?: 'steps' | 'settings' | 'history';
  initialRuns?: FlowRun[];
};

export function GuideDetailView({
  guide,
  initialSteps,
  categories,
  siteHost,
  siteName,
  previewUrl,
  defaultTab = 'steps',
  initialRuns = [],
}: Props) {
  const [activeTab, setActiveTab] = useState<'steps' | 'settings' | 'history'>(defaultTab);
  const [canSaveSettings, setCanSaveSettings] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsStatus, setSettingsStatus] = useState<string | null>(null);

  const [canSaveSteps, setCanSaveSteps] = useState(false);
  const [isSavingSteps, setIsSavingSteps] = useState(false);
  const [stepsStatus, setStepsStatus] = useState<string | null>(null);
  const saveStepsFnRef = useRef<(() => Promise<void>) | null>(null);

  const handleRegisterStepsSave = useCallback((saveFn: () => Promise<void>) => {
    saveStepsFnRef.current = saveFn;
  }, []);

  const handleSaveSteps = async () => {
    if (saveStepsFnRef.current) {
      await saveStepsFnRef.current();
    }
  };

  const previewHref =
    previewUrl ||
    (guide.slug && guide.visibility !== 'draft' && siteHost
      ? `https://${siteHost}/g/${guide.slug}`
      : guide.url) ||
    `/d/${guide.public_id}`;

  const stepCount = initialSteps.length;
  const recordedDate = formatRecordedDate(guide.last_run_at);

  const runsToDisplay =
    initialRuns.length > 0
      ? initialRuns
      : [
          {
            id: 'current',
            started_at: guide.last_run_at || new Date().toISOString(),
            compiled_at: guide.last_run_at || null,
            status: 'compiled',
            step_count: initialSteps.length,
            cli_version: null,
            is_current: true,
          },
        ];

  return (
    <div className="stack" style={{ gap: 16 }}>
      {/* Page Header (UI-A16 Finding 6) */}
      <div className="adm-pane-header">
        <div>
          <h1>{guide.title}</h1>
          <div className="sub">
            {stepCount} {stepCount === 1 ? 'step' : 'steps'}
            {recordedDate ? ` · recorded ${recordedDate}` : ''}
            {' · Steps, settings and history'}
          </div>
        </div>
        <div className="adm-buttons">
          {activeTab === 'steps' && stepsStatus && (
            <small
              className={`msg ${stepsStatus.startsWith('Error') || stepsStatus.toLowerCase().includes('failed') ? 'bad' : 'ok'}`}
              role="status"
            >
              {stepsStatus}
            </small>
          )}
          {activeTab === 'settings' && settingsStatus && (
            <small
              className={`msg ${settingsStatus.startsWith('Error') ? 'bad' : 'ok'}`}
              role="status"
            >
              {settingsStatus}
            </small>
          )}
          <Link
            href={previewHref}
            target="_blank"
            rel="noopener noreferrer"
            className="btn"
          >
            Preview
          </Link>
          {activeTab === 'steps' && (
            <button
              type="button"
              disabled={!canSaveSteps || isSavingSteps}
              className="btn btn-primary"
              onClick={handleSaveSteps}
            >
              {isSavingSteps ? 'Saving…' : 'Save steps'}
            </button>
          )}
          {activeTab === 'settings' && (
            <button
              type="submit"
              form="guide-settings-form"
              disabled={!canSaveSettings || isSavingSettings}
              className="btn btn-primary"
            >
              {isSavingSettings ? 'Saving…' : 'Save changes'}
            </button>
          )}
        </div>
      </div>

      {/* Tabs navigation (UI-A16 Finding 1 & 12) */}
      <div className="adm-tabs" role="tablist" aria-label="Guide sections">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'steps'}
          className={activeTab === 'steps' ? 'adm-tab active' : 'adm-tab'}
          onClick={() => setActiveTab('steps')}
        >
          Steps
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'settings'}
          className={activeTab === 'settings' ? 'adm-tab active' : 'adm-tab'}
          onClick={() => setActiveTab('settings')}
        >
          Settings
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'history'}
          className={activeTab === 'history' ? 'adm-tab active' : 'adm-tab'}
          onClick={() => setActiveTab('history')}
        >
          History
        </button>
      </div>

      {/* Tab Panels */}
      {activeTab === 'steps' ? (
        <GuideStepsEditor
          guide={guide}
          initialSteps={initialSteps}
          runs={initialRuns}
          onCanSaveChange={setCanSaveSteps}
          onSavingChange={setIsSavingSteps}
          onStatusChange={setStepsStatus}
          registerSave={handleRegisterStepsSave}
        />
      ) : activeTab === 'settings' ? (
        <GuideSettingsForm
          guide={guide}
          categories={categories}
          siteHost={siteHost}
          siteName={siteName}
          previewUrl={previewUrl}
          onCanSaveChange={setCanSaveSettings}
          onSavingChange={setIsSavingSettings}
          onStatusChange={setSettingsStatus}
        />
      ) : (
        /* History Tab Panel (UI-A16 Finding 1) */
        <div className="card">
          <h3>Recording history</h3>
          <p className="sub" style={{ margin: '4px 0 16px' }}>
            Recordings and compilations behind this guide.
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
            {runsToDisplay.map((run) => (
              <li
                key={run.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px 14px',
                  borderRadius: 8,
                  border: '1px solid var(--a-line, #dde4e0)',
                  background: 'var(--a-bg, #f5f7f6)',
                }}
              >
                <div>
                  <b style={{ display: 'block', fontSize: 14 }}>
                    {formatRunDateTime(run.started_at) || 'Recording session'}
                  </b>
                  <span className="sub" style={{ fontSize: 13 }}>
                    {run.cli_version ? `Recorded via CLI ${run.cli_version}` : 'Recorded session'},{' '}
                    {run.step_count} {run.step_count === 1 ? 'step' : 'steps'}
                  </span>
                </div>
                <span
                  className={`badge ${run.is_current || run.status === 'compiled' ? 'badge-ok' : 'badge-muted'}`}
                >
                  {run.is_current || run.status === 'compiled' ? 'published' : 'not published'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
