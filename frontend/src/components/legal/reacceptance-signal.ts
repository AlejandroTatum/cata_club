/**
 * Detects the backend's re-acceptance block on ANY browser request.
 *
 * Once the server enforces the re-acceptance (403 with `codigo`
 * `reaceptacion_legal_pendiente`), every module request of a pending account
 * fails with that body. Wrapping `window.fetch` lets the gate react to the
 * block wherever it surfaces — services, components, direct `fetch` calls —
 * without touching each caller.
 */

export const REACCEPTANCE_REQUIRED_CODE = "reaceptacion_legal_pendiente";

/** Installs the interceptor and returns the function that restores the original `fetch`. */
export function watchForReacceptanceBlock(onBlocked: () => void): () => void {
  const originalFetch = window.fetch;

  const wrapped: typeof window.fetch = async (...args) => {
    const response = await originalFetch.apply(window, args);
    if (response.status === 403) {
      void response
        .clone()
        .json()
        .then((body: unknown) => {
          if ((body as { codigo?: unknown } | null)?.codigo === REACCEPTANCE_REQUIRED_CODE) onBlocked();
        })
        .catch(() => undefined);
    }
    return response;
  };
  window.fetch = wrapped;

  return (): void => {
    if (window.fetch === wrapped) window.fetch = originalFetch;
  };
}
