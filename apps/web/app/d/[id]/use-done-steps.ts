'use client';

import { useCallback, useEffect, useState } from 'react';

export function getStorageKey(docId: string): string {
  return `od-done:${docId}`;
}

export function parseStoredOrders(raw: string | null, validOrders?: number[]): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const validSet = validOrders ? new Set(validOrders) : null;
    return parsed.filter((item): item is number => {
      return typeof item === 'number' && (!validSet || validSet.has(item));
    });
  } catch {
    return [];
  }
}

function getStorage(): Storage | null {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

export function readStoredOrders(key: string, validOrders?: number[]): number[] {
  const storage = getStorage();
  if (!storage) return [];
  try {
    return parseStoredOrders(storage.getItem(key), validOrders);
  } catch {
    return [];
  }
}

export function writeStoredOrders(key: string, orders: number[]): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(orders));
  } catch {
    // Ignore storage blocked/quota errors
  }
}

export type UseDoneStepsResult = {
  doneOrders: number[];
  isDone: (order: number) => boolean;
  toggle: (order: number) => void;
  toggleDone: (order: number) => void;
  doneCount: number;
};

export function useDoneSteps(docId: string, validOrders?: number[]): UseDoneStepsResult {
  const key = getStorageKey(docId);
  const [doneOrders, setDoneOrders] = useState<number[]>([]);

  useEffect(() => {
    if (!docId) return;
    setDoneOrders(readStoredOrders(key, validOrders));

    const onStorage = (event: StorageEvent) => {
      if (event.key === key) {
        setDoneOrders(parseStoredOrders(event.newValue, validOrders));
      }
    };

    const onCustom = (event: Event) => {
      const custom = event as CustomEvent<{ key: string; orders: number[] }>;
      if (custom.detail?.key === key) {
        const next = custom.detail.orders;
        const validSet = validOrders ? new Set(validOrders) : null;
        const filtered = validSet ? next.filter((o) => validSet.has(o)) : next;
        setDoneOrders(filtered);
      }
    };

    window.addEventListener('storage', onStorage);
    window.addEventListener('od-done-change', onCustom);

    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('od-done-change', onCustom);
    };
  }, [docId, key, validOrders?.join(',')]);

  const toggle = useCallback(
    (order: number) => {
      if (!docId) return;
      setDoneOrders((prev) => {
        const next = prev.includes(order) ? prev.filter((o) => o !== order) : [...prev, order];
        writeStoredOrders(key, next);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('od-done-change', { detail: { key, orders: next } }));
        }
        return next;
      });
    },
    [docId, key]
  );

  return {
    doneOrders,
    isDone: useCallback((order: number) => doneOrders.includes(order), [doneOrders]),
    toggle,
    toggleDone: toggle,
    doneCount: doneOrders.length,
  };
}
