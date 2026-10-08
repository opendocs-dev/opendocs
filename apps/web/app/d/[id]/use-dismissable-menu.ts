'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = 'a[href], button, [tabindex]';

/**
 * Shared open/close state for the share menu and the mobile step-jump menu:
 * closes on outside click or Esc, moves focus to the first menu item on
 * open, returns focus to the trigger on Esc, and exposes the refs both
 * menus need (container for outside-click detection, menu for the
 * focus-first-item lookup).
 */
export function useDismissableMenu(): {
  open: boolean;
  setOpen: (open: boolean) => void;
  containerRef: RefObject<HTMLDivElement | null>;
  menuRef: (node: HTMLElement | null) => void;
} {
  const [open, setOpenState] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuNodeRef = useRef<HTMLElement | null>(null);
  const menuRef = useCallback((node: HTMLElement | null) => {
    menuNodeRef.current = node;
  }, []);
  const triggerRef = useRef<HTMLElement | null>(null);

  const setOpen = useCallback((next: boolean) => {
    if (next) triggerRef.current = document.activeElement as HTMLElement | null;
    setOpenState(next);
  }, []);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpenState(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setOpenState(false);
      triggerRef.current?.focus();
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    menuNodeRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
  }, [open]);

  return { open, setOpen, containerRef, menuRef };
}
