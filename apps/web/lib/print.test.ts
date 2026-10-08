import { describe, expect, mock, test } from 'bun:test';

function makeImg(overrides: Partial<HTMLImageElement> = {}): HTMLImageElement {
  const listeners: Record<string, Array<() => void>> = {};

  return {
    loading: 'lazy',
    complete: false,
    addEventListener: (event: string, handler: () => void) => {
      listeners[event] ??= [];
      listeners[event].push(handler);
    },
    removeEventListener: () => {},
    ...overrides,
    // expose for tests that need to trigger load/error manually
    __listeners: listeners,
  } as unknown as HTMLImageElement;
}

describe('printDoc', () => {
  test('switches every img[loading=lazy] to eager before print', async () => {
    const img1 = makeImg({ complete: true });
    const img2 = makeImg({ complete: true });

    const fakeDocument = {
      querySelectorAll: mock(() => [img1, img2]),
    } as unknown as Document;

    const originalPrint = (globalThis as { print?: () => void }).print;
    const printSpy = mock(() => {});
    (globalThis as { print: () => void }).print = printSpy;
    (globalThis as unknown as { window: Window }).window = globalThis as unknown as Window;

    const { printDoc } = await import('./print');
    await printDoc(fakeDocument);

    expect(img1.loading).toBe('eager');
    expect(img2.loading).toBe('eager');
    expect(printSpy).toHaveBeenCalledTimes(1);

    if (originalPrint) (globalThis as { print: () => void }).print = originalPrint;
  });

  test('waits for incomplete images to load or error before printing', async () => {
    const img = makeImg({ complete: false });

    const fakeDocument = {
      querySelectorAll: mock(() => [img]),
    } as unknown as Document;

    const printSpy = mock(() => {});
    (globalThis as { print: () => void }).print = printSpy;
    (globalThis as unknown as { window: Window }).window = globalThis as unknown as Window;

    const { printDoc } = await import('./print');
    const printPromise = printDoc(fakeDocument);

    expect(printSpy).not.toHaveBeenCalled();

    const listeners = (img as unknown as { __listeners: Record<string, Array<() => void>> })
      .__listeners;
    listeners.load?.forEach((handler) => handler());

    await printPromise;

    expect(printSpy).toHaveBeenCalledTimes(1);
  });
});
