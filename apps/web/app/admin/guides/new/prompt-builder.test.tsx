import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { PromptBuilder } from './prompt-builder';
import { startRecordingStatusPoller, type RecordingStatus } from './recording-poller';

describe('PromptBuilder Component and Live Agent Progress (UI-A17 Finding 2)', () => {
  test('renders initial disconnected state with setup callout when hasKey is false', () => {
    const html = renderToStaticMarkup(
      <PromptBuilder categoryNames={['billing', 'support']} hasKey={false} />,
    );

    expect(html).toContain('Waiting for your agent');
    expect(html).toContain('Agent connected');
    expect(html).toContain('Recording started');
    expect(html).toContain('Guide compiled and filed');
    expect(html).toContain('No agent connected yet? Set one up in API and MCP.');
    expect(html).toContain('Open setup');
    expect(html).toContain('href="/admin/keys"');
    // None of the items are marked done
    expect(html).not.toContain('class="done"');
  });

  test('renders Agent connected with key name and relative time when status shows connected agent', () => {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const status: RecordingStatus = {
      connected: true,
      has_key: true,
      key_name: 'Support agent key',
      key_last_used: twoMinutesAgo,
      recording_started: false,
      steps_count: 0,
      compile_state: 'none',
    };

    const html = renderToStaticMarkup(
      <PromptBuilder
        categoryNames={[]}
        hasKey={true}
        initialStatus={status}
      />,
    );

    expect(html).toContain('Agent connected (Support agent key, used 2 minutes ago)');
    expect(html).toContain('class="done"');
    // Callout should be hidden
    expect(html).not.toContain('No agent connected yet? Set one up in API and MCP.');
  });

  test('renders Agent connected with used time when key has no name', () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const status: RecordingStatus = {
      connected: true,
      has_key: true,
      key_last_used: fiveMinutesAgo,
      recording_started: false,
      steps_count: 0,
      compile_state: 'none',
    };

    const html = renderToStaticMarkup(
      <PromptBuilder
        categoryNames={[]}
        hasKey={true}
        initialStatus={status}
      />,
    );

    expect(html).toContain('Agent connected (used 5 minutes ago)');
    expect(html).toContain('class="done"');
  });

  test('renders Recording started with step count', () => {
    const status: RecordingStatus = {
      connected: true,
      has_key: true,
      recording_started: true,
      steps_count: 4,
      compile_state: 'none',
    };

    const html = renderToStaticMarkup(
      <PromptBuilder
        categoryNames={[]}
        hasKey={true}
        initialStatus={status}
      />,
    );

    expect(html).toContain('Recording started (4 steps)');
    expect(html).toContain('Agent connected');
  });

  test('renders Recording started with singular 1 step', () => {
    const status: RecordingStatus = {
      connected: true,
      has_key: true,
      recording_started: true,
      steps_count: 1,
      compile_state: 'none',
    };

    const html = renderToStaticMarkup(
      <PromptBuilder
        categoryNames={[]}
        hasKey={true}
        initialStatus={status}
      />,
    );

    expect(html).toContain('Recording started (1 step)');
  });

  test('renders Guide compiled and filed with link to guide when compile is done', () => {
    const status: RecordingStatus = {
      connected: true,
      has_key: true,
      recording_started: true,
      steps_count: 8,
      compile_state: 'done',
      guide_id: 'guide_abc123',
    };

    const html = renderToStaticMarkup(
      <PromptBuilder
        categoryNames={[]}
        hasKey={true}
        initialStatus={status}
      />,
    );

    expect(html).toContain('Guide compiled and filed');
    expect(html).toContain('href="/admin/guides/guide_abc123"');
  });
});

describe('Recording Status Poller with Fake Timers', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('polls every 3 seconds while document is visible', async () => {
    let callCount = 0;
    const fetchMock = async () => {
      callCount++;
      return new Response(
        JSON.stringify({
          connected: false,
          has_key: false,
          recording_started: false,
          steps_count: 0,
          compile_state: 'none',
        }),
        { status: 200 },
      );
    };

    const received: RecordingStatus[] = [];
    const stop = startRecordingStatusPoller({
      onStatus: (s) => received.push(s),
      fetchFn: fetchMock as unknown as typeof fetch,
    });

    expect(callCount).toBe(0);

    // After 3 seconds, first poll fires
    jest.advanceTimersByTime(3000);
    // Allow microtasks/promises to drain
    await Promise.resolve();
    expect(callCount).toBe(1);

    // After another 3 seconds, second poll fires
    jest.advanceTimersByTime(3000);
    await Promise.resolve();
    expect(callCount).toBe(2);

    // After another 3 seconds, third poll fires
    jest.advanceTimersByTime(3000);
    await Promise.resolve();
    expect(callCount).toBe(3);

    expect(received.length).toBe(3);
    stop();
  });

  test('pauses polling when document is hidden and resumes when visible', async () => {
    let callCount = 0;
    const fetchMock = async () => {
      callCount++;
      return new Response(
        JSON.stringify({
          connected: true,
          has_key: true,
          recording_started: false,
          steps_count: 0,
          compile_state: 'none',
        }),
        { status: 200 },
      );
    };

    let visibility: DocumentVisibilityState = 'visible';
    const listeners: Record<string, () => void> = {};
    const fakeDoc = {
      get visibilityState() {
        return visibility;
      },
      addEventListener: (event: string, handler: () => void) => {
        listeners[event] = handler;
      },
      removeEventListener: (event: string) => {
        delete listeners[event];
      },
    } as unknown as Document;

    const stop = startRecordingStatusPoller({
      onStatus: () => {},
      fetchFn: fetchMock as unknown as typeof fetch,
      documentRef: fakeDoc,
    });

    // 1st tick while visible
    jest.advanceTimersByTime(3000);
    await Promise.resolve();
    expect(callCount).toBe(1);

    // Page becomes hidden
    visibility = 'hidden';

    // 2nd tick while hidden -> fetch is skipped
    jest.advanceTimersByTime(3000);
    await Promise.resolve();
    expect(callCount).toBe(1);

    // 3rd tick while hidden -> fetch is still skipped
    jest.advanceTimersByTime(3000);
    await Promise.resolve();
    expect(callCount).toBe(1);

    // Page becomes visible again -> triggers visibilitychange
    visibility = 'visible';
    listeners['visibilitychange']?.();
    await Promise.resolve();
    expect(callCount).toBe(2);

    stop();
  });

  test('stops polling after 10 minutes', async () => {
    let currentTime = 1000000;
    let callCount = 0;
    const fetchMock = async () => {
      callCount++;
      return new Response(
        JSON.stringify({
          connected: true,
          has_key: true,
          recording_started: false,
          steps_count: 0,
          compile_state: 'none',
        }),
        { status: 200 },
      );
    };

    const stop = startRecordingStatusPoller({
      onStatus: () => {},
      fetchFn: fetchMock as unknown as typeof fetch,
      now: () => currentTime,
      maxDurationMs: 10 * 60 * 1000,
    });

    // Advance 9 minutes (540,000 ms) in 3s steps
    for (let i = 0; i < 180; i++) {
      currentTime += 3000;
      jest.advanceTimersByTime(3000);
      await Promise.resolve();
    }
    expect(callCount).toBe(180);

    // Advance past 10 minutes
    for (let i = 0; i < 30; i++) {
      currentTime += 3000;
      jest.advanceTimersByTime(3000);
      await Promise.resolve();
    }
    // Call count stops after 10 minutes
    expect(callCount).toBe(199);

    // Further timer ticks do not increase count
    currentTime += 30000;
    jest.advanceTimersByTime(30000);
    await Promise.resolve();
    expect(callCount).toBe(199);

    stop();
  });

  test('stops polling immediately when compile is done', async () => {
    let callCount = 0;
    let compileState: 'none' | 'running' | 'done' = 'none';

    const fetchMock = async () => {
      callCount++;
      return new Response(
        JSON.stringify({
          connected: true,
          has_key: true,
          recording_started: true,
          steps_count: callCount,
          compile_state: compileState,
          guide_id: compileState === 'done' ? 'guide_final' : null,
        }),
        { status: 200 },
      );
    };

    const updates: RecordingStatus[] = [];
    const stop = startRecordingStatusPoller({
      onStatus: (s) => updates.push(s),
      fetchFn: fetchMock as unknown as typeof fetch,
    });

    // 1st tick: recording
    jest.advanceTimersByTime(3000);
    await Promise.resolve();
    expect(callCount).toBe(1);
    expect(updates[0]?.compile_state).toBe('none');

    // 2nd tick: compile finished
    compileState = 'done';
    jest.advanceTimersByTime(3000);
    await Promise.resolve();
    expect(callCount).toBe(2);
    expect(updates[1]?.compile_state).toBe('done');
    expect(updates[1]?.guide_id).toBe('guide_final');

    // Subsequent ticks: poller has stopped, no further fetches
    jest.advanceTimersByTime(3000);
    await Promise.resolve();
    jest.advanceTimersByTime(6000);
    await Promise.resolve();
    expect(callCount).toBe(2);

    stop();
  });

  test('stop function cancels any pending timer and cleans up listener', async () => {
    let callCount = 0;
    const fetchMock = async () => {
      callCount++;
      return new Response(JSON.stringify({ compile_state: 'none' }), { status: 200 });
    };

    let listenerRemoved = false;
    const fakeDoc = {
      visibilityState: 'visible',
      addEventListener: () => {},
      removeEventListener: (event: string) => {
        if (event === 'visibilitychange') listenerRemoved = true;
      },
    } as unknown as Document;

    const stop = startRecordingStatusPoller({
      onStatus: () => {},
      fetchFn: fetchMock as unknown as typeof fetch,
      documentRef: fakeDoc,
    });

    stop();

    expect(listenerRemoved).toBe(true);

    // Advancing timers should not cause any fetch calls
    jest.advanceTimersByTime(9000);
    await Promise.resolve();
    expect(callCount).toBe(0);
  });
});
