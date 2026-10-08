export type RecordingStatus = {
  connected: boolean;
  has_key: boolean;
  key_name?: string | null;
  key_last_used?: string | null;
  recording_started: boolean;
  steps_count: number;
  compile_state: 'none' | 'running' | 'done';
  guide_id?: string | null;
  session_id?: string | null;
};

export type PollerOptions = {
  onStatus: (status: RecordingStatus) => void;
  intervalMs?: number;
  maxDurationMs?: number;
  fetchFn?: typeof fetch;
  now?: () => number;
  documentRef?: Document;
  since?: string;
};

export function startRecordingStatusPoller(options: PollerOptions): () => void {
  const {
    onStatus,
    intervalMs = 3000,
    maxDurationMs = 10 * 60 * 1000,
    fetchFn = globalThis.fetch,
    now = () => Date.now(),
    documentRef = typeof document !== 'undefined' ? document : undefined,
    since,
  } = options;

  let stopped = false;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  const startTime = now();

  async function poll() {
    if (stopped) return;
    if (now() - startTime >= maxDurationMs) {
      stopped = true;
      return;
    }

    const isVisible = !documentRef || documentRef.visibilityState === 'visible';

    if (isVisible) {
      try {
        const url = since
          ? `/api/v1/recording-status?since=${encodeURIComponent(since)}`
          : '/api/v1/recording-status';
        const res = await fetchFn(url, {
          credentials: 'include',
          cache: 'no-store',
        });
        if (res.ok) {
          const data: RecordingStatus = await res.json();
          if (stopped) return;
          onStatus(data);
          if (data.compile_state === 'done') {
            stopped = true;
            return;
          }
        }
      } catch {
        // network error, continue polling next interval
      }
    }

    if (stopped) return;
    if (now() - startTime >= maxDurationMs) {
      stopped = true;
      return;
    }

    timerId = setTimeout(poll, intervalMs);
  }

  // Schedule first poll after intervalMs
  timerId = setTimeout(poll, intervalMs);

  const handleVisibilityChange = () => {
    if (stopped) return;
    if (documentRef && documentRef.visibilityState === 'visible') {
      if (now() - startTime < maxDurationMs) {
        if (timerId) clearTimeout(timerId);
        void poll();
      }
    }
  };

  if (documentRef && typeof documentRef.addEventListener === 'function') {
    documentRef.addEventListener('visibilitychange', handleVisibilityChange);
  }

  return () => {
    stopped = true;
    if (timerId) clearTimeout(timerId);
    if (documentRef && typeof documentRef.removeEventListener === 'function') {
      documentRef.removeEventListener('visibilitychange', handleVisibilityChange);
    }
  };
}
