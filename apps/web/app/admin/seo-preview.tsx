/**
 * Google search result and social share previews for a page's SEO title, description
 * and image (C14-AC09, AC-13). Pure display: the caller owns the field values.
 */
type Props = {
  url: string;
  title: string;
  description: string;
  imageUrl?: string | null;
  siteName?: string | null;
  asCards?: boolean;
};

function formatGoogleUrl(rawUrl: string): string {
  if (!rawUrl || rawUrl === '/') return 'acme.opendocs.xxx';
  try {
    const urlStr = rawUrl.startsWith('/')
      ? `https://acme.opendocs.xxx${rawUrl}`
      : rawUrl.startsWith('http')
        ? rawUrl
        : `https://${rawUrl}`;
    const parsed = new URL(urlStr);
    const host = parsed.host || 'acme.opendocs.xxx';
    const parts = parsed.pathname.split('/').filter(Boolean);
    return parts.length > 0 ? `${host} › ${parts.join(' › ')}` : host;
  } catch {
    const clean = rawUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const parts = clean.split('/').filter(Boolean);
    return parts.length > 1 ? parts.join(' › ') : (clean || 'acme.opendocs.xxx');
  }
}

function formatShareUrl(rawUrl: string): string {
  if (!rawUrl || rawUrl === '/') return 'acme.opendocs.xxx';
  try {
    const urlStr = rawUrl.startsWith('/')
      ? `https://acme.opendocs.xxx${rawUrl}`
      : rawUrl.startsWith('http')
        ? rawUrl
        : `https://${rawUrl}`;
    const parsed = new URL(urlStr);
    return parsed.host || 'acme.opendocs.xxx';
  } catch {
    const clean = rawUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    return clean || 'acme.opendocs.xxx';
  }
}

export function SeoPreview({ url, title, description, imageUrl, siteName, asCards }: Props) {
  const googleUrl = formatGoogleUrl(url);
  const shareUrl = formatShareUrl(url);
  const displayTitle = title || 'Acmeco Help';
  const displayDescription = description || 'No description set';

  const googleContent = (
    <div className="seo-preview-google">
      <div className="seo-preview-google-url">{googleUrl}</div>
      <div className="seo-preview-google-title">{displayTitle}</div>
      <div className="seo-preview-google-desc">{displayDescription}</div>
    </div>
  );

  const shareContent = (
    <div className="seo-preview-share">
      {imageUrl ? (
        <img src={imageUrl} alt="" className="seo-preview-share-image" />
      ) : (
        <div className="seo-preview-share-banner">
          {siteName && <div className="seo-preview-share-banner-site">{siteName}</div>}
          <div className="seo-preview-share-banner-title">{displayTitle}</div>
        </div>
      )}
      <div className="seo-preview-share-body">
        <div className="seo-preview-share-url">{shareUrl}</div>
        <div className="seo-preview-share-title">{displayTitle}</div>
        <div className="seo-preview-share-desc">{displayDescription}</div>
      </div>
    </div>
  );

  if (asCards) {
    return (
      <div className="stack">
        <div className="card">
          <h3>Google preview</h3>
          <div style={{ marginTop: '12px' }}>
            {googleContent}
          </div>
        </div>
        <div className="card">
          <h3>Share preview</h3>
          <div style={{ marginTop: '12px' }}>
            {shareContent}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="seo-preview">
      <div className="seo-preview-block">
        <div className="seo-preview-label">Google preview</div>
        {googleContent}
      </div>
      <div className="seo-preview-block">
        <div className="seo-preview-label">Share preview</div>
        {shareContent}
      </div>
    </div>
  );
}
