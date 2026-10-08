import type { FlowItem, AdminCategory } from './server-api';

/**
 * Returns a display label for a visibility status.
 * 'published' => 'Published', 'unlisted' => 'Unlisted', 'draft' => 'Draft', anything else => 'Published'.
 */
export function visibilityLabel(visibility: string | undefined): string {
  switch (visibility) {
    case 'published':
      return 'Published';
    case 'unlisted':
      return 'Unlisted';
    case 'draft':
      return 'Draft';
    default:
      return 'Published';
  }
}

/**
 * Returns a tone ('ok' | 'warn' | 'muted') for badge styling based on visibility.
 */
export function visibilityTone(visibility: string | undefined): 'ok' | 'warn' | 'muted' {
  switch (visibility) {
    case 'published':
      return 'ok';
    case 'unlisted':
      return 'muted';
    case 'draft':
      return 'warn';
    default:
      return 'ok';
  }
}

/**
 * Returns a public link for a guide, or null if no link is available.
 * For published/unlisted guides with a slug, returns the public page URL.
 * Otherwise returns the guide's url only when it's an http(s) URL.
 */
export function publicLink(
  guide: {
    public_id: string;
    slug?: string | null;
    visibility?: string;
    url?: string | null;
  },
): string | null {
  // Check if it's published or unlisted with a slug
  if (
    (guide.visibility === 'published' || guide.visibility === 'unlisted') &&
    guide.slug
  ) {
    return `/g/${guide.slug}`;
  }

  // Fall back to guide.url if it's a valid http(s) URL
  if (guide.url) {
    try {
      const url = new URL(guide.url);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        return guide.url;
      }
    } catch {
      // ignore invalid URLs
    }
  }

  return null;
}

/**
 * Returns a label for a category option.
 */
export function categoryOption(category: AdminCategory): string {
  return category.name;
}
