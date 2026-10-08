import {
  GetDocResponseSchema,
  type Box,
  type DocStep,
  type DocStepImage,
  type Viewport,
} from '@opendocs/core';
import { Elysia } from 'elysia';
import { assetUrl } from '../asset-url';
import { getPrisma } from '../db';
import { ApiError } from '../errors';
import { hasMemberSession } from '../site/session';

const notFound = () => new ApiError(404, 'not_found', 'Doc not found');

type AssetForImage = {
  publicId: string;
  providerFileId: string;
  deletedAt: Date | null;
  expiresAt: Date | null;
  width: number;
  height: number;
} | null;

export const imageFor = (asset: AssetForImage): DocStepImage => {
  const now = Date.now();
  if (!asset || asset.deletedAt || (asset.expiresAt && asset.expiresAt.getTime() <= now)) {
    return { url: null, expired: true };
  }

  return {
    url: assetUrl(asset),
    expired: false,
    width: asset.width,
    height: asset.height,
  };
};

export type StepForDoc = {
  order: number;
  action: string;
  instruction: string;
  title: string | null;
  alt: string | null;
  pageUrl: string | null;
  selector: string | null;
  box: unknown;
  redactionMode: string | null;
  redactionReport: unknown;
  asset: AssetForImage;
};

/** Shared by the JSON doc route and the reader site guide route: same step shape, same rules. */
export const toDocStep = (step: StepForDoc): DocStep => {
  const report = step.redactionReport as { viewport?: Viewport; iframes?: number } | null;

  return {
    order: step.order,
    action: step.action,
    instruction: step.instruction,
    ...(step.title !== null ? { title: step.title } : {}),
    ...(step.alt !== null ? { alt: step.alt } : {}),
    ...(step.pageUrl !== null ? { page_url: step.pageUrl } : {}),
    ...(step.selector !== null ? { selector: step.selector } : {}),
    ...(step.box !== null ? { box: step.box as Box } : {}),
    image: imageFor(step.asset),
    ...(step.redactionMode !== null ? { redaction_mode: step.redactionMode } : {}),
    ...(report?.viewport !== undefined ? { viewport: report.viewport } : {}),
    ...(report?.iframes !== undefined ? { iframes: report.iframes } : {}),
  };
};

/**
 * Resolves the flow, its latest run's steps and their images: shared by both the
 * JSON and markdown doc routes so the 404 rules (unknown, deleted, not compiled)
 * stay in one place.
 */
const loadDoc = async (publicId: string, request: Request) => {
  const flow = await getPrisma().flow.findFirst({
    where: { publicId, deletedAt: null, latestRunId: { not: null } },
    select: { publicId: true, title: true, organizationId: true, latestRunId: true, visibility: true },
  });
  if (!flow || !flow.latestRunId) throw notFound();
  // A draft answers 404 to anonymous callers, like an unknown id (C23 AC-09).
  if (flow.visibility === 'draft' && !(await hasMemberSession(request))) throw notFound();

  const steps = await getPrisma().step.findMany({
    where: { runId: flow.latestRunId, hidden: false },
    orderBy: { order: 'asc' },
    include: { asset: true },
  });

  return { flow, steps };
};

const MAX_SPAN_LENGTH = 200;

type InlineSpan = { kind: 'text' | 'bold' | 'code'; text: string };

const isValidBoldInner = (inner: string) => {
  if (inner.length < 1 || inner.length > MAX_SPAN_LENGTH) return false;
  if (inner.includes('*') || inner.includes('\n') || inner.includes('\r')) return false;
  return inner.trim() === inner;
};

const isValidCodeInner = (inner: string) => {
  if (inner.length < 1 || inner.length > MAX_SPAN_LENGTH) return false;
  return !inner.includes('`') && !inner.includes('\n') && !inner.includes('\r');
};

/**
 * Splits on `**bold**` spans (text 1-200 chars, no `*`, no newline, not
 * starting/ending with whitespace), matched left to right and non-overlapping.
 */
const splitBoldSpans = (text: string): InlineSpan[] => {
  const parts: InlineSpan[] = [];
  let plainStart = 0;
  let i = 0;

  while (i < text.length) {
    if (text[i] === '*' && text[i + 1] === '*') {
      const closeIndex = text.indexOf('**', i + 2);
      const inner = closeIndex === -1 ? '' : text.slice(i + 2, closeIndex);

      if (closeIndex !== -1 && isValidBoldInner(inner)) {
        if (i > plainStart) parts.push({ kind: 'text', text: text.slice(plainStart, i) });
        parts.push({ kind: 'bold', text: inner });
        i = closeIndex + 2;
        plainStart = i;
        continue;
      }
    }
    i++;
  }

  if (plainStart < text.length) parts.push({ kind: 'text', text: text.slice(plainStart) });

  return parts;
};

/**
 * Splits on backtick code spans first (backtick + 1-200 chars with no backtick
 * and no newline + backtick), matched left to right; their content is never
 * parsed for bold. The text outside code spans is then split on `**bold**`
 * spans via splitBoldSpans. Runs on the raw instruction text, before newlines
 * are collapsed, so a span that straddles a newline is correctly rejected
 * rather than joined by a space.
 */
const splitInlineSpans = (text: string): InlineSpan[] => {
  const parts: InlineSpan[] = [];
  let plainStart = 0;
  let i = 0;

  while (i < text.length) {
    if (text[i] === '`') {
      const closeIndex = text.indexOf('`', i + 1);
      const inner = closeIndex === -1 ? '' : text.slice(i + 1, closeIndex);

      if (closeIndex !== -1 && isValidCodeInner(inner)) {
        if (i > plainStart) parts.push(...splitBoldSpans(text.slice(plainStart, i)));
        parts.push({ kind: 'code', text: inner });
        i = closeIndex + 1;
        plainStart = i;
        continue;
      }
    }
    i++;
  }

  if (plainStart < text.length) parts.push(...splitBoldSpans(text.slice(plainStart)));

  return parts;
};

const escapeChars = (text: string) => text.replace(/[\\`*_\[\]<>!|~]/g, '\\$&');

/**
 * Alt text sits inside `![alt](url)`, so unescaped `\\`, `]`, `[`, `(` or `)` could
 * break out of the alt span or the destination; newlines are collapsed like
 * other text since alt renders as a single attribute value.
 */
const escapeAlt = (text: string) => text.replace(/\r?\n/g, ' ').replace(/[\\[\]()]/g, '\\$&');

const escapeLeadingMarker = (line: string) =>
  line.replace(/^( {0,3})([#\-+]|\d+[.)])/, (_, spaces, marker) =>
    spaces + (/^\d/.test(marker) ? `${marker.slice(0, -1)}\\${marker.slice(-1)}` : `\\${marker}`),
  );

/**
 * Title and instructions are written by any API-key holder and this output gets pasted
 * into READMEs and wikis, so they must render as plain text: one line (a newline could
 * start a heading or list). Characters that can start markup anywhere in the line are
 * backslash-escaped (link/image brackets, raw HTML angle brackets, emphasis, code
 * fences); `#`, `-`, `+` and a leading ordered-list marker are only dangerous at the
 * start of the line, so only that leading occurrence is escaped there. Everything else
 * (parens, braces, dots, mid-line dashes/pluses) is left plain so prose stays readable.
 *
 * Two exceptions to that escaping (see splitInlineSpans), both matched left to right,
 * code spans first: a well-formed `` `code` `` span (agents write inline filenames like
 * `` save `Bun_(software).pdf` ``) is emitted verbatim, since its content is literal in
 * CommonMark and cannot contain a backtick or newline; a well-formed `**bold**` span
 * (agents write instructions like `Click **Add to cart**`) is kept as real bold, with
 * its inner text still escaped.
 */
const escapeText = (text: string) => {
  const rendered = splitInlineSpans(text)
    .map((part) => {
      if (part.kind === 'code') return `\`${part.text}\``;
      if (part.kind === 'bold') return `**${escapeChars(part.text)}**`;
      return escapeChars(part.text.replace(/\r?\n/g, ' '));
    })
    .join('');

  return escapeLeadingMarker(rendered);
};

const buildMarkdown = (
  title: string,
  steps: Array<{
    order: number;
    instruction: string;
    title?: string;
    alt?: string;
    image: DocStepImage;
  }>,
) => {
  const lines = [`# ${escapeText(title)}`, ''];

  for (const step of steps) {
    const heading = step.title ? `## Step ${step.order}: ${escapeText(step.title)}` : `## Step ${step.order}`;
    lines.push(heading, '', escapeText(step.instruction), '');
    const altText = step.alt ? escapeAlt(step.alt) : `Step ${step.order}`;
    lines.push(
      step.image.url ? `![${altText}](${step.image.url})` : '_Image no longer available._',
      '',
    );
  }

  return lines.join('\n');
};

/**
 * Public and unauthenticated: the publicId is the only credential, matching the
 * image route. `X-Robots-Tag: noindex` keeps published docs out of search indexes.
 */
export const docsRoute = new Elysia()
  .get(
    '/api/v1/docs/:publicId',
    async ({ params, set, request }) => {
      set.headers['x-robots-tag'] = 'noindex';

      const { flow, steps } = await loadDoc(params.publicId, request);

      return {
        public_id: flow.publicId,
        title: flow.title,
        steps: steps.map((step, index) => toDocStep({ ...step, order: index + 1 })),
      };
    },
    { response: { 200: GetDocResponseSchema } },
  )
  .get('/api/v1/docs/:publicId/markdown', async ({ params, set, request }) => {
    set.headers['x-robots-tag'] = 'noindex';

    const { flow, steps } = await loadDoc(params.publicId, request);
    const body = buildMarkdown(
      flow.title,
      steps.map((step, index) => ({
        order: index + 1,
        instruction: step.instruction,
        ...(step.title !== null ? { title: step.title } : {}),
        ...(step.alt !== null ? { alt: step.alt } : {}),
        image: imageFor(step.asset),
      })),
    );

    return new Response(body, {
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
        'x-robots-tag': 'noindex',
      },
    });
  });
