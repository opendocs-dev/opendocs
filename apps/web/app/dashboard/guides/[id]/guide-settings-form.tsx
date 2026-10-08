'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { FlowItem, AdminCategory } from '@/lib/server-api';
import { apiErrorMessage } from '@/lib/site-address';
import { categoryOption, publicLink } from '@/lib/guide-labels';
import { SeoPreview } from '../../seo-preview';

const MAX_TITLE = 120;
const MAX_SUMMARY = 300;
const MAX_SEO_TITLE = 60;
const MAX_SEO_DESCRIPTION = 160;

type Props = {
  guide: FlowItem;
  categories: AdminCategory[];
  siteHost: string | null;
  siteName?: string | null;
  previewUrl?: string | null;
  onCanSaveChange?: (canSave: boolean) => void;
  onSavingChange?: (saving: boolean) => void;
  onStatusChange?: (status: string | null) => void;
};

export function GuideSettingsForm({
  guide,
  categories,
  siteHost,
  siteName,
  previewUrl,
  onCanSaveChange,
  onSavingChange,
  onStatusChange,
}: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(guide.title);
  const [slug, setSlug] = useState(guide.slug || '');
  const [summary, setSummary] = useState(guide.summary || '');
  const [visibility, setVisibility] = useState<FlowItem['visibility']>(guide.visibility || 'published');
  const [categoryId, setCategoryId] = useState(guide.category?.id || '');
  const [seoTitle, setSeoTitle] = useState(guide.seo_title || '');
  const [seoDescription, setSeoDescription] = useState(guide.seo_description || '');
  const [noindex, setNoindex] = useState(guide.noindex || false);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const titleError =
    title.trim().length === 0
      ? 'Title is required'
      : title.length > MAX_TITLE
        ? `Title must be at most ${MAX_TITLE} characters`
        : null;

  const slugTrimmed = slug.trim();
  const slugError =
    slugTrimmed.length === 0
      ? 'Address is required'
      : slugTrimmed.length > 60
        ? 'Address must be at most 60 characters'
        : !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slugTrimmed)
          ? 'Address must use lowercase letters, numbers, and hyphens without consecutive hyphens'
          : null;

  const hasChanges =
    title !== guide.title ||
    slug !== (guide.slug || '') ||
    summary !== (guide.summary || '') ||
    visibility !== (guide.visibility || 'published') ||
    categoryId !== (guide.category?.id || '') ||
    seoTitle !== (guide.seo_title || '') ||
    seoDescription !== (guide.seo_description || '') ||
    noindex !== (guide.noindex || false);

  const canSave = !titleError && !slugError && hasChanges && !saving;

  useEffect(() => {
    onCanSaveChange?.(canSave);
  }, [canSave, onCanSaveChange]);

  useEffect(() => {
    onSavingChange?.(saving);
  }, [saving, onSavingChange]);

  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  const save = async () => {
    if (!canSave) return;

    setSaving(true);
    setStatus(null);

    try {
      const updates: Record<string, unknown> = {};
      if (title !== guide.title) updates.title = title;
      if (slug !== (guide.slug || '')) updates.slug = slug.trim().toLowerCase();
      if (summary !== (guide.summary || '')) updates.summary = summary;
      if (visibility !== (guide.visibility || 'published')) updates.visibility = visibility;
      if (seoTitle !== (guide.seo_title || '')) updates.seo_title = seoTitle;
      if (seoDescription !== (guide.seo_description || '')) updates.seo_description = seoDescription;
      if (noindex !== (guide.noindex || false)) updates.noindex = noindex;

      // Save main fields
      if (Object.keys(updates).length > 0) {
        const response = await fetch(`/api/v1/flows/${guide.public_id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(updates),
        });

        if (!response.ok) {
          const body = await response.json();
          const err = `Error: ${apiErrorMessage(body, 'Failed to save')}`;
          setStatus(err);
          setSaving(false);
          return;
        }
      }

      // Save category separately if changed
      if (categoryId !== (guide.category?.id || '')) {
        const response = await fetch(`/api/v1/flows/${guide.public_id}/category`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ category_id: categoryId === '' ? null : categoryId }),
        });

        if (!response.ok) {
          const body = await response.json();
          const err = `Error: ${apiErrorMessage(body, 'Failed to save category')}`;
          setStatus(err);
          setSaving(false);
          return;
        }
      }

      setStatus('Saved');
      setSaving(false);
      router.refresh();
    } catch {
      setStatus('Error saving guide');
      setSaving(false);
    }
  };

  const isSuggestedCategory = guide.category?.status === 'suggested';
  const effectiveSlug = slug.trim() || guide.slug;
  const displayUrl =
    siteHost && effectiveSlug && visibility !== 'draft'
      ? `https://${siteHost}/g/${effectiveSlug}`
      : previewUrl || publicLink(guide, siteHost) || `/d/${guide.public_id}`;

  return (
    <form
      id="guide-settings-form"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="split"
    >
      {/* Left column: General and Search engines cards */}
      <div className="stack">
        {/* General card */}
        <div className="card">
          <h3>General</h3>

          <div className="fld">
            <label htmlFor="title">Title</label>
            <input
              id="title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={MAX_TITLE}
            />
            {titleError && <small className="msg bad">{titleError}</small>}
            {!titleError && <small className="cnt">{title.length} / {MAX_TITLE}</small>}
          </div>

          <div className="fld">
            <label htmlFor="summary">Summary</label>
            <textarea
              id="summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              maxLength={MAX_SUMMARY}
            />
            <small className="cnt">{summary.length} / {MAX_SUMMARY}</small>
          </div>

          <div className="fld">
            <label htmlFor="slug">Address</label>
            <div className="inl">
              <input
                id="slug"
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                maxLength={60}
                autoComplete="off"
                spellCheck="false"
              />
              <span>/g/</span>
            </div>
            {slugError && <small className="msg bad">{slugError}</small>}
            {!slugError && (
              <small className="muted">
                Changing the address changes the guide link. Old links are not redirected.
              </small>
            )}
          </div>

          <div className="fld">
            <label htmlFor="category">Category</label>
            <select
              id="category"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">Uncategorized</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {categoryOption(cat)}
                </option>
              ))}
            </select>
            {isSuggestedCategory && guide.category?.name && (
              <small
                className="muted"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  color: 'var(--a-brand)',
                  marginTop: 6,
                }}
              >
                <span className="cat-sparkle" aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M8 1.5l1.5 4 4 1.5-4 1.5-1.5 4-1.5 4-1.5 1.5-4z" />
                  </svg>
                </span>
                Your agent chose {guide.category.name} when it recorded this guide.
              </small>
            )}
          </div>

          <div className="fld">
            <label>Status</label>
            <div className="radio-group" role="radiogroup" aria-label="Status">
              <label className={`radio-label ${visibility === 'published' ? 'checked' : ''}`}>
                <input
                  type="radio"
                  name="visibility"
                  value="published"
                  checked={visibility === 'published'}
                  onChange={() => setVisibility('published')}
                />
                <span>
                  <strong>Published</strong>
                  <small>Visible on your site and in search.</small>
                </span>
              </label>

              <label className={`radio-label ${visibility === 'unlisted' ? 'checked' : ''}`}>
                <input
                  type="radio"
                  name="visibility"
                  value="unlisted"
                  checked={visibility === 'unlisted'}
                  onChange={() => setVisibility('unlisted')}
                />
                <span>
                  <strong>Unlisted</strong>
                  <small>Only people with the link. Not in search or sitemap.</small>
                </span>
              </label>

              <label className={`radio-label ${visibility === 'draft' ? 'checked' : ''}`}>
                <input
                  type="radio"
                  name="visibility"
                  value="draft"
                  checked={visibility === 'draft'}
                  onChange={() => setVisibility('draft')}
                />
                <span>
                  <strong>Draft</strong>
                  <small>
                    Hidden on your site. The direct link /d/{guide.public_id} still opens for anyone who has it.
                  </small>
                </span>
              </label>
            </div>
          </div>
        </div>

        {/* Search engines card */}
        <div className="card">
          <h3>Search engines</h3>
          <p className="sub">Leave empty to use the guide title and summary.</p>

          <div className="fld">
            <label htmlFor="seo-title">Page title</label>
            <input
              id="seo-title"
              type="text"
              value={seoTitle}
              onChange={(e) => setSeoTitle(e.target.value)}
              maxLength={MAX_SEO_TITLE}
              placeholder={title}
            />
            <small className="cnt">{seoTitle.length} / {MAX_SEO_TITLE}</small>
          </div>

          <div className="fld">
            <label htmlFor="seo-description">Page description</label>
            <textarea
              id="seo-description"
              value={seoDescription}
              onChange={(e) => setSeoDescription(e.target.value)}
              maxLength={MAX_SEO_DESCRIPTION}
            />
            <small className="cnt">{seoDescription.length} / {MAX_SEO_DESCRIPTION}</small>
          </div>

          <div className="fld">
            <label className="toggle">
              <input
                id="noindex"
                type="checkbox"
                checked={noindex}
                onChange={(e) => setNoindex(e.target.checked)}
              />
              <span>Hide this guide from search engines</span>
            </label>
          </div>
        </div>

        <div className="btns" style={{ marginTop: '16px' }}>
          <button
            type="submit"
            disabled={!canSave}
            className="btn btn-primary"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          {status && (
            <small className={`msg ${status.startsWith('Error') ? 'bad' : 'ok'}`} role="status">
              {status}
            </small>
          )}
        </div>
      </div>

      {/* Right column: Previews as cards */}
      <div className="stack">
        <SeoPreview
          url={displayUrl}
          title={seoTitle || title}
          description={seoDescription || summary || 'No description set'}
          siteName={siteName}
          asCards={true}
        />
      </div>
    </form>
  );
}
