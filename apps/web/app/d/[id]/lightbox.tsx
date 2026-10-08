'use client';

import type { CSSProperties, MouseEvent } from 'react';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

import type { DocStep } from '@opendocs/core';

import { boxInCrop, cropRect, lightboxMinSize, overlayPercent, zoomPlacement } from '@/lib/crop';

import { Pin, Ring } from './step-image';

export type LightboxHandle = { open: (index: number) => void };

type LightboxProps = { steps: DocStep[] };

export function hasImage(step: DocStep): boolean {
  return !!step.image.url && !step.image.expired;
}

export function nextIndex(steps: DocStep[], currentIndex: number): number {
  for (let i = currentIndex + 1; i < steps.length; i++) {
    if (hasImage(steps[i])) return i;
  }
  return currentIndex;
}

export function prevIndex(steps: DocStep[], currentIndex: number): number {
  for (let i = currentIndex - 1; i >= 0; i--) {
    if (hasImage(steps[i])) return i;
  }
  return currentIndex;
}

export function stepAltText(step: DocStep): string {
  return step.alt ?? `Step ${step.order}`;
}

export type LightboxView = {
  placement: ReturnType<typeof zoomPlacement> | null;
  overlay: ReturnType<typeof overlayPercent>;
};

/**
 * Pure computation of what the lightbox should render for `step`: the
 * full-image placement percentages (zoom mode only) and the highlight
 * overlay (in crop-relative percentages for zoom, image-relative for fit).
 * Extracted so the pin/overlay math is testable without mounting the
 * stateful <dialog>.
 */
export function computeLightboxView(
  step: DocStep | null,
  mode: 'fit' | 'zoom',
  dialogWidth: number | null
): LightboxView {
  const box = step?.box;
  const width = step?.image.width;
  const height = step?.image.height;

  if (!box || !width || !height) return { placement: null, overlay: null };

  const minSize = lightboxMinSize(dialogWidth ?? Infinity);
  const crop = cropRect(box, width, height, undefined, minSize);
  const placement = mode === 'zoom' ? zoomPlacement(width, crop) : null;
  const overlay =
    mode === 'zoom' ? overlayPercent(boxInCrop(box, crop), crop.w, crop.h) : overlayPercent(box, width, height);

  return { placement, overlay };
}

export const Lightbox = forwardRef<LightboxHandle, LightboxProps>(function Lightbox(
  { steps },
  ref
) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [index, setIndex] = useState<number | null>(null);
  const [mode, setMode] = useState<'fit' | 'zoom'>('zoom');
  const [dialogWidth, setDialogWidth] = useState<number | null>(null);
  const isOpen = index !== null;

  useImperativeHandle(ref, () => ({
    open(i: number) {
      openerRef.current = document.activeElement as HTMLElement | null;
      setMode('zoom');
      setIndex(i);
    },
  }));

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) dialog.showModal();
  }, [isOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !isOpen) return;

    setDialogWidth(dialog.getBoundingClientRect().width);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setDialogWidth(entry.contentRect.width);
    });
    observer.observe(dialog);

    return () => observer.disconnect();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'ArrowRight') {
        setIndex((current) => (current === null ? current : nextIndex(steps, current)));
      } else if (event.key === 'ArrowLeft') {
        setIndex((current) => (current === null ? current : prevIndex(steps, current)));
      }
    }

    dialog.addEventListener('keydown', handleKeyDown);
    return () => dialog.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, steps]);

  function handleDialogClose() {
    setIndex(null);
    openerRef.current?.focus();
  }

  function handleDialogClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === dialogRef.current) dialogRef.current?.close();
  }

  const step = index === null ? null : steps[index];
  const box = step?.box;
  const { placement, overlay } = computeLightboxView(step, mode, dialogWidth);
  const wrapperStyle: CSSProperties = placement ? { aspectRatio: '16 / 9' } : {};

  return (
    <dialog
      ref={dialogRef}
      className="step-lightbox"
      onClose={handleDialogClose}
      onClick={handleDialogClick}
    >
      {step && step.image.url && (
        <div className="step-lightbox-body">
          <button type="button" className="btn close" onClick={() => dialogRef.current?.close()}>
            Close
          </button>
          {box && (
            <div className="step-lightbox-toolbar">
              <button
                type="button"
                className="secondary"
                onClick={() => setMode((current) => (current === 'fit' ? 'zoom' : 'fit'))}
              >
                {mode === 'fit' ? 'Zoom' : 'Fit'}
              </button>
            </div>
          )}
          <div className="step-lightbox-image-wrapper" style={wrapperStyle}>
            {placement ? (
              <img
                src={step.image.url}
                alt={stepAltText(step)}
                className="step-lightbox-img"
                style={{
                  position: 'absolute',
                  width: `${placement.widthPercent}%`,
                  left: `${placement.leftPercent}%`,
                  top: `${placement.topPercent}%`,
                  height: 'auto',
                }}
              />
            ) : (
              <img
                src={step.image.url}
                alt={stepAltText(step)}
                style={{ width: '100%', height: 'auto', display: 'block' }}
              />
            )}
            {overlay && <Ring overlay={overlay} />}
            {overlay && <Pin order={step.order} overlay={overlay} />}
          </div>
        </div>
      )}
    </dialog>
  );
});
