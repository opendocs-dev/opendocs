'use client';

import { printDoc } from '@/lib/print';

function PdfIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

export function PdfButton() {
  return (
    <button type="button" className="btn btn-primary" onClick={() => void printDoc()}>
      <PdfIcon />
      <span className="label">PDF</span>
    </button>
  );
}
