/**
 * Detects the backend's re-acceptance block on ANY browser request.
 *
 * Once the server enforces the re-acceptance (403 with `codigo`
 * `reaceptacion_legal_pendiente`), every module request of a pending account
 * fails. Wrapping `window.fetch` lets the gate react wherever it surfaces —
 * services, components, direct `fetch` calls — without touching each caller.
 *
 * Fast path: the 403 body carries the code. Slow path: some BFF routes drop
 * the code and relay a bare 403, so any other 403 triggers a re-check of the
 * status endpoint — single-flight, with a cooldown, and never for the status
 * endpoint itself, so it cannot loop or storm.
 */

export const REACCEPTANCE_REQUIRED_CODE = "reaceptacion_legal_pendiente";
export const RECHECK_COOLDOWN_MS = 10_000;

interface WatchOptions {
  onBlocked: () => void;
  /** Resolves true when the status endpoint reports a pending acceptance; null/false otherwise. */
  recheck: () => Promise<boolean | null>;
  /** Requests to this URL are never inspected (the re-check itself). */
  statusUrl: string;
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.pathname : input.url;
}

/** Installs the interceptor and returns the function that restores the original `fetch`. */
export function watchForReacceptanceBlock({ onBlocked, recheck, statusUrl }: WatchOptions): () => void {
  const originalFetch = window.fetch;
  let inFlight = false;
  let lastCheckAt = Number.NEGATIVE_INFINITY;

  const recheckOnce = (): void => {
    const now = Date.now();
    if (inFlight || now - lastCheckAt < RECHECK_COOLDOWN_MS) return;
    inFlight = true;
    lastCheckAt = now;
    void recheck()
      .then((pending) => {
        if (pending === true) onBlocked();
      })
      .catch(() => undefined)
      .finally(() => {
        inFlight = false;
      });
  };

  const wrapped: typeof window.fetch = async (...args) => {
    const response = await originalFetch.apply(window, args);
    if (response.status === 403 && !requestUrl(args[0]).startsWith(statusUrl)) {
      void response
        .clone()
        .json()
        .then((body: unknown) => {
          if ((body as { codigo?: unknown } | null)?.codigo === REACCEPTANCE_REQUIRED_CODE) onBlocked();
          else recheckOnce();
        })
        .catch(recheckOnce);
    }
    return response;
  };
  window.fetch = wrapped;

  return (): void => {
    if (window.fetch === wrapped) window.fetch = originalFetch;
  };
}
