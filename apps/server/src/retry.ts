// Short waits, the CLI has its own longer retries
export const UPSTREAM_RETRY_DELAYS_MS = [500, 1500];

const worthRetry = (status: number) => status === 429 || status >= 500;

function wait(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

// Retry a call that failed before any answer came back
export async function fetchWithRetry(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
  delaysMs: number[] = UPSTREAM_RETRY_DELAYS_MS,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const last = attempt >= delaysMs.length;
    try {
      const res = await fetchFn(url, init);
      if (last || !worthRetry(res.status)) return res;
      await res.body?.cancel().catch(() => {});
    } catch (error) {
      if (last || init.signal?.aborted) throw error;
    }
    await wait(delaysMs[attempt]!, init.signal);
  }
}
