'use client';

import { useState } from 'react';
import type { AdminCategory, SiteInfo } from '@/lib/server-api';
import { apiErrorMessage } from '@/lib/api-error';

export type PresetId = 'sage' | 'atlas' | 'ledger';

export interface PresetDef {
  id: PresetId;
  name: string;
  description: string;
  minPlan: 'free' | 'pro' | 'enterprise';
  colors: {
    paper: string;
    accent: string;
    mark: string;
  };
}

export const PRESETS: PresetDef[] = [
  {
    id: 'sage',
    name: 'Sage',
    description: 'Friendly guide with a highlighter. Our default.',
    minPlan: 'free',
    colors: {
      paper: '#ECF1EE',
      accent: '#0F6B54',
      mark: '#FFC83D',
    },
  },
  {
    id: 'atlas',
    name: 'Atlas',
    description: 'Documentation portal with a docs-style layout.',
    minPlan: 'pro',
    colors: {
      paper: '#F7F8FA',
      accent: '#2450D6',
      mark: '#FFE14D',
    },
  },
  {
    id: 'ledger',
    name: 'Ledger',
    description: 'Editorial and sober. Serif type, thin rules.',
    minPlan: 'pro',
    colors: {
      paper: '#FAFAFA',
      accent: '#8C1D2C',
      mark: '#FFD9A8',
    },
  },
];

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!match) return null;
  return {
    r: parseInt(match[1], 16),
    g: parseInt(match[2], 16),
    b: parseInt(match[3], 16),
  };
}

function luminance(r: number, g: number, b: number): number {
  const a = [r, g, b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

export function contrastRatio(hex1: string, hex2: string): number {
  const c1 = parseHex(hex1);
  const c2 = parseHex(hex2);
  if (!c1 || !c2) return 1;
  const l1 = luminance(c1.r, c1.g, c1.b);
  const l2 = luminance(c2.r, c2.g, c2.b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(1));
}

type Props = {
  initial: SiteInfo;
  categories?: AdminCategory[];
};

export function AppearanceForm({ initial, categories }: Props) {
  const [savedPreset, setSavedPreset] = useState<PresetId>(
    (initial.preset as PresetId) || 'sage',
  );
  const [selectedPreset, setSelectedPreset] = useState<PresetId>(savedPreset);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Enterprise custom panel state (AC-11)
  // No plans on a self-hosted instance: custom branding is always on (C23 AC-19).
  const isEnterprise = true;
  const hasSavedCustom =
    isEnterprise &&
    (initial.accent != null ||
      initial.mark != null ||
      initial.font != null ||
      initial.radius != null);

  const [savedAccent, setSavedAccent] = useState<string | null>(initial.accent ?? null);
  const [savedMark, setSavedMark] = useState<string | null>(initial.mark ?? null);
  const [savedFont, setSavedFont] = useState<string | null>(initial.font ?? null);
  const [savedRadius, setSavedRadius] = useState<number | null>(initial.radius ?? null);

  const [customBase, setCustomBase] = useState<PresetId>(
    hasSavedCustom ? (initial.preset as PresetId) : 'atlas',
  );
  const [accent, setAccent] = useState(initial.accent || '#6B2FBF');
  const [mark, setMark] = useState(initial.mark || '#FFD54A');
  const [font, setFont] = useState(initial.font || 'DM Sans');
  const [radius, setRadius] = useState(initial.radius ?? 10);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [faviconUrl, setFaviconUrl] = useState<string | null>(initial.favicon_url ?? null);
  const [isCustomPreview, setIsCustomPreview] = useState(hasSavedCustom);

  const accentContrast = contrastRatio(accent, '#FFFFFF');
  const isLowContrast = accentContrast < 4.5;

  const isPresetAllowed = (presetId: PresetId): boolean => {
    void presetId;
    return true;
  };

  const hasCustomChanges =
    isEnterprise &&
    isCustomPreview &&
    (customBase !== savedPreset ||
      accent !== (savedAccent ?? '#6B2FBF') ||
      mark !== (savedMark ?? '#FFD54A') ||
      font !== (savedFont ?? 'DM Sans') ||
      radius !== (savedRadius ?? 10) ||
      savedAccent === null);

  const hasPresetChanges =
    selectedPreset !== savedPreset || (isEnterprise && !isCustomPreview && savedAccent !== null);

  const hasChanges = isCustomPreview ? hasCustomChanges : hasPresetChanges;

  const handleSave = async () => {
    if (!hasChanges || (isEnterprise && isCustomPreview && isLowContrast)) return;
    setSaving(true);
    setError(null);
    setStatus(null);

    const payload =
      isEnterprise && isCustomPreview
        ? {
            preset: customBase,
            accent,
            mark,
            font,
            radius,
          }
        : isEnterprise
          ? {
              preset: selectedPreset,
              accent: null,
              mark: null,
              font: null,
              radius: null,
            }
          : { preset: selectedPreset };

    try {
      const response = await fetch('/api/v1/site/appearance', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(apiErrorMessage(body, `Save failed (${response.status})`));
      }

      const data = (await response.json()) as {
        preset: PresetId;
        accent?: string | null;
        mark?: string | null;
        font?: string | null;
        radius?: number | null;
      };
      setSavedPreset(data.preset);
      setSelectedPreset(data.preset);
      if (isCustomPreview) {
        setCustomBase(data.preset);
      }
      setSavedAccent(data.accent ?? null);
      setSavedMark(data.mark ?? null);
      setSavedFont(data.font ?? null);
      setSavedRadius(data.radius ?? null);
      setStatus('Saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const activeDef = PRESETS.find((p) => p.id === selectedPreset) ?? PRESETS[0];
  const customBaseDef = PRESETS.find((p) => p.id === customBase) ?? PRESETS[0];

  const previewColors = isCustomPreview
    ? {
        paper: customBaseDef.colors.paper,
        accent,
        mark,
      }
    : activeDef.colors;

  const previewFont = isCustomPreview
    ? font
    : selectedPreset === 'ledger'
      ? 'serif'
      : 'inherit';

  const previewRadius = isCustomPreview
    ? radius
    : selectedPreset === 'sage'
      ? 14
      : 8;

  const previewTitle = isCustomPreview ? `Custom (${customBaseDef.name})` : activeDef.name;

  const categoryList =
    categories && categories.length > 0
      ? categories.slice(0, 3).map((c) => ({
          id: c.id,
          name: c.name,
          description: c.description || 'Explore documentation and step-by-step guides.',
          guidesCount: 3,
        }))
      : [
          {
            id: '1',
            name: 'Getting Started',
            description: 'Quick setup, verified installation steps and onboarding.',
            guidesCount: 3,
          },
          {
            id: '2',
            name: 'API & Integration',
            description: 'Authenticate, query API endpoints and configure webhooks.',
            guidesCount: 4,
          },
          {
            id: '3',
            name: 'Guides & Workflows',
            description: 'Common tasks, step-by-step instructions and best practices.',
            guidesCount: 3,
          },
        ];

  return (
    <div className="stack">
      <div className="adm-pane-header">
        <div>
          <h1>Appearance</h1>
          <div>Choose how your public site looks</div>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saving || !hasChanges || (isEnterprise && isCustomPreview && isLowContrast)}
        >
          {saving ? 'Saving...' : 'Save appearance'}
        </button>
      </div>

      {status && (
        <p className="msg ok" role="status">
          {status}
        </p>
      )}
      {error && (
        <p className="msg err" role="alert">
          {error}
        </p>
      )}

      {/* Presets Card */}
      <div className="card">
        <div className="lab">Presets</div>

        <div className="adm-presets" id="presetcards">
          {PRESETS.map((p) => {
            const allowed = isPresetAllowed(p.id);
            const isSelected = !isCustomPreview && selectedPreset === p.id;
            return (
              <button
                key={p.id}
                type="button"
                className="adm-preset-card"
                data-preset={p.id}
                data-need={p.minPlan}
                aria-pressed={isSelected}
                disabled={!allowed}
                onClick={() => {
                  if (allowed) {
                    setSelectedPreset(p.id);
                    setIsCustomPreview(false);
                    setStatus(null);
                    setError(null);
                  }
                }}
              >
                <span className="adm-preset-th" style={{ background: p.colors.paper }}>
                  <u style={{ background: p.colors.accent }} />
                  <i style={{ background: `${p.colors.accent}33`, width: '86%' }} />
                  <i style={{ background: p.colors.mark, width: '34%' }} />
                </span>
                <b>
                  {p.name}
                </b>
                <span className="sub" style={{ fontSize: '12.5px' }}>{p.description}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Two-column split: Custom branding on left, Preview on right */}
      <div className="split">
        {/* Enterprise Custom Branding Panel (AC-11) */}
        <div className={`card card-lock ${isEnterprise ? '' : 'is-locked'}`} data-need="enterprise">

          <div className="adm-preset-header">
            <div>
              <h3>Custom branding</h3>
              <p className="sub">Starts from a preset. Your colors are checked so text stays readable.</p>
            </div>
          </div>

          <div className="fld" style={{ marginTop: '16px' }}>
            <label htmlFor="cb-base">Start from</label>
            <select
              id="cb-base"
              value={customBase}
              disabled={!isEnterprise}
              onChange={(e) => {
                setCustomBase(e.target.value as PresetId);
                setIsCustomPreview(true);
              }}
            >
              <option value="sage">Sage</option>
              <option value="atlas">Atlas</option>
              <option value="ledger">Ledger</option>
            </select>
          </div>

          <div className="adm-colors-grid" style={{ marginTop: '12px' }}>
            <div className="fld">
              <label htmlFor="cb-acc">Accent</label>
              <div className="adm-color-input-wrap">
                <input
                  type="color"
                  id="cb-accc"
                  value={accent}
                  disabled={!isEnterprise}
                  aria-label="Accent color picker"
                  onChange={(e) => {
                    setAccent(e.target.value);
                    setIsCustomPreview(true);
                  }}
                />
                <input
                  type="text"
                  id="cb-acc"
                  value={accent}
                  disabled={!isEnterprise}
                  maxLength={7}
                  onChange={(e) => {
                    setAccent(e.target.value);
                    setIsCustomPreview(true);
                  }}
                />
              </div>
            </div>

            <div className="fld">
              <label htmlFor="cb-mark">Highlighter</label>
              <div className="adm-color-input-wrap">
                <input
                  type="color"
                  id="cb-markc"
                  value={mark}
                  disabled={!isEnterprise}
                  aria-label="Highlighter color picker"
                  onChange={(e) => {
                    setMark(e.target.value);
                    setIsCustomPreview(true);
                  }}
                />
                <input
                  type="text"
                  id="cb-mark"
                  value={mark}
                  disabled={!isEnterprise}
                  maxLength={7}
                  onChange={(e) => {
                    setMark(e.target.value);
                    setIsCustomPreview(true);
                  }}
                />
              </div>
            </div>
          </div>

          {isLowContrast ? (
            <p className="msg err" role="alert" style={{ marginTop: '10px' }}>
              Low contrast ({accentContrast}:1 against white). Text on accent may be hard to read; needs at least 4.5:1.
            </p>
          ) : (
            <p className="msg ok" style={{ marginTop: '10px' }}>
              ✓ Accent text contrast {accentContrast}:1
            </p>
          )}

          <div className="fld" style={{ marginTop: '12px' }}>
            <label htmlFor="cb-font">Font</label>
            <select
              id="cb-font"
              value={font}
              disabled={!isEnterprise}
              onChange={(e) => {
                setFont(e.target.value);
                setIsCustomPreview(true);
              }}
            >
              <option value="DM Sans">DM Sans</option>
              <option value="Inter">Inter</option>
              <option value="IBM Plex Sans">IBM Plex Sans</option>
              <option value="Source Sans 3">Source Sans 3</option>
              <option value="Lora">Lora</option>
              <option value="Source Serif 4">Source Serif 4</option>
              <option value="Bricolage Grotesque">Bricolage Grotesque</option>
            </select>
          </div>

          <div className="fld" style={{ marginTop: '12px' }}>
            <label htmlFor="cb-rad">
              Corner radius <span>{radius}</span> px
            </label>
            <input
              type="range"
              id="cb-rad"
              min={0}
              max={20}
              value={radius}
              disabled={!isEnterprise}
              onChange={(e) => {
                setRadius(Number(e.target.value));
                setIsCustomPreview(true);
              }}
            />
          </div>

          <div className="fld" style={{ marginTop: '14px' }}>
            <label>Logo and favicon</label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '6px' }}>
              <label
                htmlFor="upload-logo-input"
                className={`btn ${isEnterprise ? '' : 'disabled'}`}
                style={{ cursor: isEnterprise ? 'pointer' : 'not-allowed', margin: 0 }}
              >
                Upload logo
              </label>
              <input
                type="file"
                id="upload-logo-input"
                accept="image/png,image/svg+xml,image/jpeg,image/webp"
                style={{ display: 'none' }}
                disabled={!isEnterprise}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const url = URL.createObjectURL(file);
                    setLogoUrl(url);
                  }
                }}
              />

              <label
                htmlFor="upload-favicon-input"
                className={`btn ${isEnterprise ? '' : 'disabled'}`}
                style={{ cursor: isEnterprise ? 'pointer' : 'not-allowed', margin: 0 }}
              >
                Upload favicon
              </label>
              <input
                type="file"
                id="upload-favicon-input"
                accept="image/png,image/svg+xml,image/x-icon,image/jpeg,image/webp"
                style={{ display: 'none' }}
                disabled={!isEnterprise}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const url = URL.createObjectURL(file);
                    setFaviconUrl(url);
                  }
                }}
              />
              {logoUrl && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => setLogoUrl(null)}
                  style={{ fontSize: '12px', padding: '6px 10px' }}
                >
                  Remove logo
                </button>
              )}
              {faviconUrl && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => setFaviconUrl(null)}
                  style={{ fontSize: '12px', padding: '6px 10px' }}
                >
                  Remove favicon
                </button>
              )}
            </div>
            <small className="muted" style={{ display: 'block', marginTop: '6px' }}>
              PNG or SVG. Shown in the navbar and browser tab.
            </small>
          </div>

          <div style={{ display: 'flex', gap: '8px', marginTop: '18px' }}>
            <button
              type="button"
              className="btn"
              disabled={!isEnterprise}
              onClick={() => setIsCustomPreview(true)}
            >
              Preview custom
            </button>
            <button
              type="button"
              className="btn"
              disabled={!isEnterprise}
              onClick={() => {
                setAccent('#6B2FBF');
                setMark('#FFD54A');
                setFont('DM Sans');
                setRadius(10);
                setCustomBase('atlas');
                setLogoUrl(null);
                setFaviconUrl(null);
                setIsCustomPreview(false);
              }}
            >
              Reset
            </button>
          </div>
        </div>

        {/* Live Preview Card */}
        <div className="card">
          <div className="adm-preset-header">
            <div className="lab">Preview</div>
            <a href="/" target="_blank" rel="noreferrer" className="sub" style={{ textDecoration: 'underline' }}>
              Open public site ↗
            </a>
          </div>

          <div className="appearance-preview-card">
            <div className="appearance-preview-bar">
              <span>Documentation Preview — {previewTitle}</span>
              <span style={{ color: previewColors.accent, fontWeight: 600 }}>
                {isCustomPreview ? 'Custom look' : 'Active look'}
              </span>
            </div>

            <div
              className="appearance-preview-viewport"
              style={{ background: previewColors.paper }}
            >
              <div
                className="appearance-preview-canvas"
                style={{
                  fontFamily: previewFont,
                  color: '#12201b',
                }}
              >
                {/* Scaled navbar */}
                <div
                  style={{
                    background: '#ffffff',
                    borderBottom: '1px solid rgba(0,0,0,0.08)',
                    padding: '12px 28px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {logoUrl ? (
                      <img
                        src={logoUrl}
                        alt="Logo"
                        style={{ height: '28px', width: 'auto', objectFit: 'contain' }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '28px',
                          height: '28px',
                          borderRadius: `${Math.min(previewRadius, 6)}px`,
                          background: previewColors.accent,
                          color: '#ffffff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 700,
                          fontSize: '14px',
                        }}
                      >
                        {(initial.site_title || 'O')[0].toUpperCase()}
                      </div>
                    )}
                    <span style={{ fontWeight: 700, fontSize: '16px' }}>
                      {initial.site_title || 'OpenDocs'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '20px', fontSize: '14px', color: '#55655f' }}>
                    <span>Guides</span>
                    <span>Categories</span>
                    <span>Contact support</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span
                      style={{
                        background: `${previewColors.accent}18`,
                        color: previewColors.accent,
                        padding: '4px 10px',
                        borderRadius: '999px',
                        fontSize: '12px',
                        fontWeight: 600,
                      }}
                    >
                      Ask AI
                    </span>
                    <button
                      type="button"
                      style={{
                        background: previewColors.accent,
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: `${Math.min(previewRadius, 8)}px`,
                        padding: '6px 14px',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Open {initial.site_title || 'OpenDocs'}
                    </button>
                  </div>
                </div>

                {/* Scaled Hero */}
                <div style={{ padding: '48px 24px 32px', textAlign: 'center' }}>
                  <h1
                    style={{
                      fontSize: '40px',
                      fontWeight: 800,
                      margin: '0 0 10px 0',
                      color: '#12201b',
                      letterSpacing: '-0.02em',
                    }}
                  >
                    How can we help?
                  </h1>
                  <p
                    style={{
                      fontSize: '16px',
                      color: '#55655f',
                      maxWidth: '560px',
                      margin: '0 auto 24px',
                    }}
                  >
                    {initial.description ||
                      `Step-by-step guides for ${initial.site_title || 'OpenDocs'}, recorded from the real product.`}
                  </p>
                  <div
                    style={{
                      maxWidth: '540px',
                      margin: '0 auto',
                      background: '#ffffff',
                      border: '1px solid #d3ddd8',
                      borderRadius: `${previewRadius}px`,
                      height: '52px',
                      padding: '0 16px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
                    }}
                  >
                    <span style={{ color: '#88948e', fontSize: '18px' }}>🔍</span>
                    <span style={{ color: '#88948e', fontSize: '15px', flex: 1, textAlign: 'left' }}>
                      Search 10 guides, try “template”
                    </span>
                    <span
                      style={{
                        background: '#f4f6f5',
                        border: '1px solid #d3ddd8',
                        borderRadius: '6px',
                        padding: '2px 8px',
                        fontSize: '12px',
                        fontWeight: 600,
                        color: '#55655f',
                      }}
                    >
                      Ctrl K
                    </span>
                  </div>
                </div>

                {/* Scaled Browse by category */}
                <div style={{ padding: '16px 32px 48px', maxWidth: '960px', margin: '0 auto' }}>
                  <h2
                    style={{
                      fontSize: '20px',
                      fontWeight: 800,
                      margin: '0 0 16px 0',
                      color: '#12201b',
                    }}
                  >
                    Browse by category
                  </h2>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, 1fr)',
                      gap: '14px',
                    }}
                  >
                    {categoryList.map((cat, idx) => (
                      <div
                        key={cat.id || idx}
                        style={{
                          background: '#ffffff',
                          border: '1px solid #d3ddd8',
                          borderRadius: `${previewRadius}px`,
                          padding: '16px',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <b style={{ fontSize: '15px', color: '#12201b' }}>{cat.name}</b>
                          <span style={{ fontSize: '12px', color: '#88948e' }}>
                            {cat.guidesCount ?? 2} guides
                          </span>
                        </div>
                        <p
                          style={{
                            fontSize: '13px',
                            color: '#55655f',
                            margin: '6px 0 10px',
                            lineHeight: 1.4,
                          }}
                        >
                          {cat.description || 'Verified guides and workflows.'}
                        </p>
                        <div
                          style={{
                            fontSize: '12px',
                            color: '#12201b',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                          }}
                        >
                          <span
                            style={{
                              width: '6px',
                              height: '6px',
                              borderRadius: '2px',
                              background: previewColors.mark,
                              flexShrink: 0,
                            }}
                          />
                          <span>Getting started walkthrough</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
