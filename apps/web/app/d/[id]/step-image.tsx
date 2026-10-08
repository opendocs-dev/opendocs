'use client';

import { useRef, type ReactNode } from 'react';

import type { Box, DocStep } from '@opendocs/core';

import { splitInline } from '@/lib/inline-bold';
import { boxInCrop, loupeCropRect, loupePlacement, overlayPercent, zoomPlacement, type OverlayRect } from '@/lib/crop';
import { hostFromPageUrl, pathFromPageUrl } from '@/lib/step-url';

import { Lightbox, type LightboxHandle } from './lightbox';
import { StepTick } from './step-tick';

/**
 * Renders `**bold**` spans and `code` spans written by agents (e.g. "Click
 * **Add to cart**" or "save `file.pdf`") as real <strong>/<code> elements
 * instead of leaking literal markers. `**bold**` renders as a mark chip
 * with --mark background and --mark-ink text.
 */
export function InlineBold({ text }: { text: string }) {
  return (
    <>
      {splitInline(text).map((part, index) => {
        if (part.kind === 'bold') return <strong key={index} className="mark">{part.text}</strong>;
        if (part.kind === 'code') return <code key={index}>{part.text}</code>;
        return <span key={index}>{part.text}</span>;
      })}
    </>
  );
}

/** Thin mark ring at `overlay`'s position. Styled differently inside `.loupe` via CSS nesting. */
export function Ring({ overlay }: { overlay: OverlayRect }) {
  return (
    <span
      className="ring"
      aria-hidden="true"
      style={{ left: `${overlay.left}%`, top: `${overlay.top}%`, width: `${overlay.width}%`, height: `${overlay.height}%` }}
    />
  );
}

/** Numbered pin at `overlay`'s top-left corner, used only inside the loupe. */
export function Pin({ order, overlay }: { order: number; overlay: OverlayRect }) {
  return (
    <span className="pin" aria-hidden="true" style={{ left: `${overlay.left}%`, top: `${overlay.top}%` }}>
      {order}
    </span>
  );
}

type StepImageProps = {
  order: number;
  index?: number;
  box?: Box;
  alt?: string;
  pageUrl?: string;
  iframes?: number;
  image: { url: string | null; expired: boolean; width?: number; height?: number };
  onOpen?: (index: number) => void;
};

function IframeNote() {
  return <p className="step-image-iframe-note">No highlight: this step happens inside an embedded frame.</p>;
}

function ImageOffIcon() {
  return (
    <svg
      aria-hidden="true"
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5-4 4-3-3-6 6" />
      <line x1="3" y1="21" x2="21" y2="3" />
    </svg>
  );
}

function FrameIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export function StepImage({ order, index, box, alt, pageUrl, iframes, image, onOpen }: StepImageProps) {
  const altText = alt ?? `Step ${order}`;

  if (image.expired) {
    return (
      <div className="step-image-placeholder">
        <ImageOffIcon />
        <span>Image no longer available</span>
      </div>
    );
  }

  if (!image.url) return null;

  const openIndex = index ?? order - 1;
  const showIframeNote = !box && !!iframes;
  const host = hostFromPageUrl(pageUrl);
  const fullPath = pathFromPageUrl(pageUrl);
  const pathAfterHost = host && fullPath.startsWith(host) ? fullPath.slice(host.length) : (fullPath ? `/${fullPath}` : '');

  let ringFull: OverlayRect | null = null;
  let loupe: ReactNode = null;

  if (box && image.width && image.height) {
    const crop = loupeCropRect(box, image.width, image.height);
    const placement = zoomPlacement(image.width, crop);
    const cropOverlay = overlayPercent(boxInCrop(box, crop), crop.w, crop.h);
    ringFull = overlayPercent(box, image.width, image.height);
    const { side, vert } = loupePlacement(box, image.width, image.height);

    loupe = (
      <button
        type="button"
        className={`loupe ${side} ${vert}`}
        aria-label={`Zoom in on step ${order}`}
        onClick={() => onOpen?.(openIndex)}
      >
        <img
          src={image.url}
          alt=""
          style={{
            position: 'absolute',
            width: `${placement.widthPercent}%`,
            left: `${placement.leftPercent}%`,
            top: `${placement.topPercent}%`,
            height: 'auto',
          }}
        />
        {cropOverlay && <Ring overlay={cropOverlay} />}
        {cropOverlay && <Pin order={order} overlay={cropOverlay} />}
      </button>
    );
  }

  return (
    <>
      <div className="frame-wrap">
        <div className="frame">
          <div className="frame-bar">
            <FrameIcon />
            <span>
              {host ? <b>{host}</b> : null}
              {pathAfterHost}
            </span>
          </div>
          <button
            type="button"
            className="shot"
            aria-label={`Open step ${order} full screenshot`}
            onClick={() => onOpen?.(openIndex)}
          >
            <img src={image.url} alt={altText} loading="lazy" style={{ width: '100%', height: 'auto', display: 'block' }} />
            {ringFull && <Ring overlay={ringFull} />}
          </button>
        </div>
        {loupe}
      </div>
      {showIframeNote && <IframeNote />}
    </>
  );
}

type StepListProps = { steps: DocStep[]; docId?: string };

export function StepList({ steps, docId }: StepListProps) {
  const lightboxRef = useRef<LightboxHandle>(null);

  return (
    <>
      <div className="steps">
        {steps.map((step, index) => {
          const showFigcaption = !!step.image.url && !step.image.expired && !!step.alt;

          return (
            <article key={step.order} id={`step-${step.order}`} className="step doc-step">
              <span className="step-no">
                <StepTick order={step.order} docId={docId} />
                <span className="print-only step-print-number" aria-hidden="true">{step.order}</span>
              </span>
              <div className="step-content">
                {step.title && <h2 className="step-title">{step.title}</h2>}
                <p className="step-instruction">
                  <InlineBold text={step.instruction} />
                </p>
                <figure>
                  <StepImage
                    order={step.order}
                    index={index}
                    box={step.box}
                    alt={step.alt}
                    pageUrl={step.page_url}
                    iframes={step.iframes}
                    image={step.image}
                    onOpen={(i) => lightboxRef.current?.open(i)}
                  />
                  {showFigcaption && <figcaption>{step.alt}</figcaption>}
                </figure>
              </div>
            </article>
          );
        })}
      </div>
      <Lightbox ref={lightboxRef} steps={steps} />
    </>
  );
}
