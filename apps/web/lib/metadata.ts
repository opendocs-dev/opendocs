import type { Metadata } from 'next';

import type { GetDocResponse } from '@opendocs/core';

import { tocLabel } from './toc';

const MAX_DESCRIPTION_LENGTH = 160;

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

/** Shape `buildDocMetadata` needs; `GetDocResponse` (apex `/d/{id}`, no SEO fields) and the
 * tenant `Guide` type (which carries them) both satisfy it. */
type MetadataDoc = GetDocResponse & {
  seo_title?: string | null;
  seo_description?: string | null;
};

function buildDescription(doc: MetadataDoc): string {
  if (doc.seo_description) return truncate(doc.seo_description, MAX_DESCRIPTION_LENGTH);

  const firstStep = doc.steps[0];
  const prefix = `${doc.steps.length} steps`;
  const label = firstStep ? tocLabel(firstStep) : '';
  const description = label ? `${prefix} · ${label}` : prefix;

  return truncate(description, MAX_DESCRIPTION_LENGTH);
}

function firstStepImageUrl(doc: MetadataDoc): string | null {
  const firstStep = doc.steps[0];
  if (!firstStep) return null;
  if (firstStep.image.expired) return null;
  return firstStep.image.url;
}

/**
 * `url` is null when there's no trusted public origin to build an absolute
 * URL from (production without PUBLIC_APP_ORIGIN set); og:url and og:image
 * are omitted in that case rather than trusting request headers.
 *
 * `fallbackImageUrl` is the site's own share image (`WorkspaceSite.ogAsset`), used only
 * when the guide has no usable step image of its own.
 */
export function buildDocMetadata(
  doc: MetadataDoc,
  url: string | null,
  fallbackImageUrl: string | null = null,
): Metadata {
  const title = doc.seo_title || doc.title;
  const description = buildDescription(doc);
  const imageUrl = url ? firstStepImageUrl(doc) ?? fallbackImageUrl : null;

  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      title,
      description,
      ...(url ? { url } : {}),
      ...(imageUrl ? { images: [{ url: imageUrl }] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
    },
  };
}
