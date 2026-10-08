'use client';

import { useRef, useState } from 'react';
import type { SiteInfo } from '@/lib/server-api';
import { apiErrorMessage } from '@/lib/api-error';
import { SeoPreview } from '../../seo-preview';

const MAX_SITE_TITLE = 60;
const MAX_DESCRIPTION = 160;

type BrandKind = 'favicon' | 'og';

type SeoFormResponse = {
  site_title: string;
  description: string;
  indexing: boolean;
  favicon_url: string | null;
  og_image_url: string | null;
};

async function uploadBrandAsset(file: File): Promise<{ id: string; url: string }> {
  const response = await fetch('/api/v1/assets', {
    method: 'POST',
    headers: { 'content-type': file.type, 'x-opendocs-kind': 'brand' },
    credentials: 'include',
    body: file,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(apiErrorMessage(body, `Upload failed (${response.status})`));
  }
  return response.json();
}

async function putSeo(body: Record<string, unknown>): Promise<Response> {
  return fetch('/api/v1/site/seo', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
}

type Props = {
  initial: SiteInfo;
  homeUrl: string;
};

export function SeoForm({ initial, homeUrl }: Props) {
  const [saved, setSaved] = useState(initial);
  const [siteTitle, setSiteTitle] = useState(initial.site_title);
  const [description, setDescription] = useState(initial.description);
  const [indexing, setIndexing] = useState(initial.indexing);
  const [publishSitemap, setPublishSitemap] = useState(initial.indexing);
  const [faviconUrl, setFaviconUrl] = useState(initial.favicon_url);
  const [faviconAssetId, setFaviconAssetId] = useState<string | null | undefined>(undefined);
  const [ogImageUrl, setOgImageUrl] = useState(initial.og_image_url);
  const [ogAssetId, setOgAssetId] = useState<string | null | undefined>(undefined);
  const [uploading, setUploading] = useState<BrandKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const faviconInputRef = useRef<HTMLInputElement>(null);
  const ogInputRef = useRef<HTMLInputElement>(null);

  const titleError =
    siteTitle.trim().length === 0
      ? 'Site title is required'
      : siteTitle.length > MAX_SITE_TITLE
        ? `Site title must be at most ${MAX_SITE_TITLE} characters`
        : null;

  const hasChanges =
    siteTitle !== saved.site_title ||
    description !== saved.description ||
    indexing !== saved.indexing ||
    faviconAssetId !== undefined ||
    ogAssetId !== undefined;

  const canSave = !titleError && hasChanges && !saving;

  async function handleUpload(kind: BrandKind, file: File) {
    setUploading(kind);
    setError(null);
    try {
      const asset = await uploadBrandAsset(file);
      if (kind === 'favicon') {
        setFaviconAssetId(asset.id);
        setFaviconUrl(asset.url);
      } else {
        setOgAssetId(asset.id);
        setOgImageUrl(asset.url);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
    } finally {
      setUploading(null);
    }
  }

  function clearBrandAsset(kind: BrandKind) {
    if (kind === 'favicon') {
      setFaviconAssetId(null);
      setFaviconUrl(null);
    } else {
      setOgAssetId(null);
      setOgImageUrl(null);
    }
  }

  async function save() {
    if (!canSave) return;

    setSaving(true);
    setStatus(null);
    setError(null);

    try {
      const body: Record<string, unknown> = {};
      if (siteTitle !== saved.site_title) body.site_title = siteTitle;
      if (description !== saved.description) body.description = description;
      if (indexing !== saved.indexing) body.indexing = indexing;
      if (faviconAssetId !== undefined) body.favicon_asset_id = faviconAssetId;
      if (ogAssetId !== undefined) body.og_asset_id = ogAssetId;

      const response = await putSeo(body);
      if (!response.ok) {
        const errBody = await response.json().catch(() => null);
        setError(apiErrorMessage(errBody, `Error saving (${response.status})`));
        return;
      }

      const result = (await response.json()) as SeoFormResponse;
      setSaved((prev) => ({ ...prev, ...result }));
      setFaviconAssetId(undefined);
      setOgAssetId(undefined);
      setStatus('Saved');
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const sitemapUrl = `${homeUrl.replace(/\/$/, '')}/sitemap.xml`;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="stack"
    >
      <div className="adm-pane-header">
        <div>
          <h1>SEO</h1>
          <div>Control how search engines and social apps show your site</div>
        </div>
        <div className="adm-buttons">
          {status && (
            <small className="msg ok" role="status">
              {status}
            </small>
          )}
          {error && (
            <small className="msg bad" role="alert">
              {error}
            </small>
          )}
          <button type="submit" disabled={!canSave} className="btn btn-primary">
            {saving ? 'Saving…' : 'Save SEO settings'}
          </button>
        </div>
      </div>

      <div className="split">
        <div className="stack">
          {/* Site Card */}
          <div className="card">
            <h3>Site</h3>

            <div className="fld">
              <label htmlFor="site-title">Site title</label>
              <input
                id="site-title"
                type="text"
                value={siteTitle}
                onChange={(e) => setSiteTitle(e.target.value)}
                maxLength={MAX_SITE_TITLE}
              />
              {titleError && <small className="msg bad">{titleError}</small>}
            </div>

            <div className="fld">
              <label htmlFor="description">Default description</label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={MAX_DESCRIPTION}
              />
              <small className="cnt">
                {description.length} / {MAX_DESCRIPTION}
              </small>
            </div>

            <div className="fld">
              <div className="lab">Share image and favicon</div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '6px' }}>
                <input
                  ref={ogInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  style={{ display: 'none' }}
                  disabled={uploading !== null}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUpload('og', file);
                    e.target.value = '';
                  }}
                />
                <input
                  ref={faviconInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  style={{ display: 'none' }}
                  disabled={uploading !== null}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUpload('favicon', file);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  className="btn"
                  disabled={uploading !== null}
                  onClick={() => ogInputRef.current?.click()}
                >
                  Upload share image
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={uploading !== null}
                  onClick={() => faviconInputRef.current?.click()}
                >
                  Upload favicon
                </button>
              </div>

              {(ogImageUrl || faviconUrl) && (
                <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginTop: '10px', flexWrap: 'wrap' }}>
                  {ogImageUrl && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <img
                        src={ogImageUrl}
                        alt="Share image preview"
                        width={80}
                        height={42}
                        style={{ objectFit: 'cover', borderRadius: '4px', border: '1px solid var(--a-line)' }}
                      />
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: '4px 8px', fontSize: '12.5px' }}
                        onClick={() => clearBrandAsset('og')}
                      >
                        Remove image
                      </button>
                    </div>
                  )}
                  {faviconUrl && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <img
                        src={faviconUrl}
                        alt="Favicon preview"
                        width={24}
                        height={24}
                        style={{ borderRadius: '4px', border: '1px solid var(--a-line)' }}
                      />
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: '4px 8px', fontSize: '12.5px' }}
                        onClick={() => clearBrandAsset('favicon')}
                      >
                        Remove favicon
                      </button>
                    </div>
                  )}
                </div>
              )}

              <small className="muted">
                Share image 1200 x 630 px. Used when a guide has no step image of its own.
              </small>
              {uploading === 'og' && <small className="muted">Uploading share image…</small>}
              {uploading === 'favicon' && <small className="muted">Uploading favicon…</small>}
            </div>
          </div>

          {/* Indexing Card */}
          <div className="card">
            <h3>Indexing</h3>

            <div className="fld">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={indexing}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setIndexing(next);
                    if (!next) {
                      setPublishSitemap(false);
                    } else {
                      setPublishSitemap(true);
                    }
                  }}
                />
                <span>Let search engines index my site</span>
              </label>
              <small className="muted">
                Off keeps every page out of search results.
              </small>
            </div>

            <div className="fld">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={publishSitemap}
                  onChange={(e) => setPublishSitemap(e.target.checked)}
                />
                <span>Publish sitemap.xml and robots.txt</span>
              </label>
              <small className="muted">
                {sitemapUrl}
              </small>
            </div>
          </div>
        </div>

        {/* Right column: Previews */}
        <div className="stack">
          <SeoPreview
            url={homeUrl}
            title={siteTitle || 'Acmeco Help'}
            description={description || 'No description set'}
            imageUrl={ogImageUrl}
            asCards={true}
          />
        </div>
      </div>
    </form>
  );
}
