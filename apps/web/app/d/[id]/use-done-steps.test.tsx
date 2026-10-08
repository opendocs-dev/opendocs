import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { Window } from 'happy-dom';
import { getStorageKey, parseStoredOrders, useDoneSteps } from './use-done-steps';

function TestConsumer({ docId, validOrders }: { docId: string; validOrders?: number[] }) {
  const { doneOrders, isDone, doneCount } = useDoneSteps(docId, validOrders);
  return (
    <div data-testid="consumer" data-count={doneCount} data-orders={doneOrders.join(',')}>
      <span className={isDone(1) ? 'done-1' : 'not-done-1'}>Step 1</span>
      <span className={isDone(2) ? 'done-2' : 'not-done-2'}>Step 2</span>
      <span className={isDone(3) ? 'done-3' : 'not-done-3'}>Step 3</span>
    </div>
  );
}

describe('useDoneSteps (AC-02)', () => {
  let store: Record<string, string> = {};
  const originalLocalStorage = globalThis.localStorage;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;

  beforeEach(() => {
    store = {};
    const storage = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        store = {};
      },
      key: () => null,
      length: 0,
    };
    globalThis.localStorage = storage;
  });

  afterEach(() => {
    globalThis.localStorage = originalLocalStorage;
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  });

  test('starts empty on initial render, then restores saved ticks after effect', async () => {
    store[getStorageKey('doc-1')] = JSON.stringify([1, 3]);

    // Initial markup (server / first client render) must match empty state
    const initialHtml = renderToStaticMarkup(<TestConsumer docId="doc-1" />);
    expect(initialHtml).toContain('data-orders=""');
    expect(initialHtml).toContain('data-count="0"');
    expect(initialHtml).toContain('not-done-1');
    expect(initialHtml).toContain('not-done-2');
    expect(initialHtml).toContain('not-done-3');

    // After effect runs on client, ticks appear
    const win = new Window();
    const env = globalThis as unknown as {
      window: unknown;
      document: unknown;
      IS_REACT_ACT_ENVIRONMENT: boolean;
      localStorage: unknown;
    };
    env.window = win;
    env.document = win.document;
    env.IS_REACT_ACT_ENVIRONMENT = true;
    win.localStorage.setItem(getStorageKey('doc-1'), JSON.stringify([1, 3]));
    env.localStorage = win.localStorage;

    const rootEl = win.document.createElement('div');
    win.document.body.appendChild(rootEl);
    const root = createRoot(rootEl as unknown as Element);

    await act(async () => {
      root.render(<TestConsumer docId="doc-1" />);
    });

    expect(rootEl.innerHTML).toContain('data-orders="1,3"');
    expect(rootEl.innerHTML).toContain('data-count="2"');
    expect(rootEl.innerHTML).toContain('done-1');
    expect(rootEl.innerHTML).toContain('not-done-2');
    expect(rootEl.innerHTML).toContain('done-3');

    await act(async () => {
      root.unmount();
    });
  });

  test('survives blocked storage', () => {
    globalThis.localStorage.getItem = () => {
      throw new Error('SecurityError: blocked');
    };
    globalThis.localStorage.setItem = () => {
      throw new Error('SecurityError: blocked');
    };

    expect(() => renderToStaticMarkup(<TestConsumer docId="doc-blocked" />)).not.toThrow();
    const html = renderToStaticMarkup(<TestConsumer docId="doc-blocked" />);
    expect(html).toContain('data-count="0"');
    expect(html).toContain('data-orders=""');
  });

  test('ignores unknown orders', async () => {
    store[getStorageKey('doc-1')] = JSON.stringify([1, 42, 999]);

    const win = new Window();
    const env = globalThis as unknown as {
      window: unknown;
      document: unknown;
      IS_REACT_ACT_ENVIRONMENT: boolean;
      localStorage: unknown;
    };
    env.window = win;
    env.document = win.document;
    env.IS_REACT_ACT_ENVIRONMENT = true;
    win.localStorage.setItem(getStorageKey('doc-1'), JSON.stringify([1, 42, 999]));
    env.localStorage = win.localStorage;

    const rootEl = win.document.createElement('div');
    win.document.body.appendChild(rootEl);
    const root = createRoot(rootEl as unknown as Element);

    await act(async () => {
      root.render(<TestConsumer docId="doc-1" validOrders={[1, 2, 3]} />);
    });

    expect(rootEl.innerHTML).toContain('data-orders="1"');
    expect(rootEl.innerHTML).toContain('data-count="1"');
    expect(rootEl.innerHTML).not.toContain('42');
    expect(rootEl.innerHTML).not.toContain('999');

    await act(async () => {
      root.unmount();
    });
  });

  test('parseStoredOrders handles invalid JSON and non-array payloads safely', () => {
    expect(parseStoredOrders(null)).toEqual([]);
    expect(parseStoredOrders('not json')).toEqual([]);
    expect(parseStoredOrders('{"foo":"bar"}')).toEqual([]);
    expect(parseStoredOrders('[1, "two", 3]')).toEqual([1, 3]);
  });
});
