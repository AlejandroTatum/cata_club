/**
 * Enrollment attempt session — the client-side half of enrollment-idempotency.
 *
 * The server owns the authoritative dedup (backend `inscripcion_idempotencia`
 * + BFF attempt-key cookie), but the VISITOR'S browser can do better: know the
 * key BEFORE the first request and REUSE it across retries of the same attempt
 * without any server round-trip. That key lives here, in `sessionStorage`:
 * same-tab lifecycle, exactly the life of an attempt.
 *
 * Contract (pinned by `src/lib/__tests__/enrollment-session.test.ts`):
 *   - `ensureEnrollmentAttemptKey()` mints once per attempt and persists it.
 *   - The same attempt (retry after a timeout/5xx) reuses the same key.
 *   - A NEW student means a NEW attempt: `clearEnrollmentAttemptKey()` before
 *     starting the next enrollment (and after a successful one).
 *
 * The wizard sends this key as the `Idempotency-Key` header; the BFF route
 * (`src/app/api/enrollment/route.ts`) forwards it and falls back to minting
 * its own key (and persisting it in a cookie) when the header is absent.
 */

const ENROLLMENT_ATTEMPT_KEY_STORAGE = "cata-club-enrollment-attempt-key";

/**
 * The current attempt's idempotency key, or `null` when this tab has not yet
 * minted one (fresh visitor or a cleared attempt).
 */
export function getEnrollmentAttemptKey(): string | null {
  try {
    return sessionStorage.getItem(ENROLLMENT_ATTEMPT_KEY_STORAGE);
  } catch {
    // Storage can be unavailable (private mode, disabled cookies); the
    // request goes out without a client key and the BFF/backend mint one.
    return null;
  }
}

/**
 * Returns the current attempt's key, minting and persisting it on first use.
 * Retries of the same attempt keep calling this and get the SAME key.
 */
export function ensureEnrollmentAttemptKey(): string {
  const existing = getEnrollmentAttemptKey();
  if (existing !== null) return existing;

  const key = crypto.randomUUID();
  try {
    sessionStorage.setItem(ENROLLMENT_ATTEMPT_KEY_STORAGE, key);
  } catch {
    // No storage, no persistence: the key still works for this one request.
  }
  return key;
}

/**
 * Forgets the current attempt's key. Call it when the attempt is consumed
 * (successful enrollment) or when the visitor starts over for a DIFFERENT
 * student — a reused key with a different payload is a 409 by design.
 */
export function clearEnrollmentAttemptKey(): void {
  try {
    sessionStorage.removeItem(ENROLLMENT_ATTEMPT_KEY_STORAGE);
  } catch {
    // Without storage there is nothing to clear.
  }
}

const LEGACY_ENROLLMENT_SESSION_KEY = "cata-club-enrollment-session";

/** Remove tokens written by the previous client-side enrollment flow. */
export function clearLegacyEnrollmentSession(): void {
  try {
    localStorage.removeItem(LEGACY_ENROLLMENT_SESSION_KEY);
  } catch {
    // Storage can be unavailable without affecting enrollment.
  }
}