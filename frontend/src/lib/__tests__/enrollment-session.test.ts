// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearEnrollmentAttemptKey,
  clearLegacyEnrollmentSession,
  ensureEnrollmentAttemptKey,
  getEnrollmentAttemptKey,
} from "../enrollment-session";

// jsdom in this environment doesn't ship a working `localStorage`/`sessionStorage`
// (Node's experimental global shadows them — see AppShell.test.tsx's
// `createMemoryStorage` for the same workaround). Stub a real in-memory
// implementation so the test exercises the actual get/set contract instead of
// failing on a missing global.
function createMemoryStorage(): Storage {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string): string | null => (key in store ? store[key] : null),
    setItem: (key: string, value: string): void => {
      store[key] = String(value);
    },
    removeItem: (key: string): void => {
      delete store[key];
    },
    clear: (): void => {
      store = {};
    },
    key: (index: number): string | null => Object.keys(store)[index] ?? null,
    get length(): number {
      return Object.keys(store).length;
    },
  } as Storage;
}

describe("clearLegacyEnrollmentSession", () => {
  it("removes the legacy client-side enrollment token record", () => {
    vi.stubGlobal("localStorage", createMemoryStorage());

    localStorage.setItem("cata-club-enrollment-session", '{"accessToken":"unsafe"}');

    clearLegacyEnrollmentSession();

    expect(localStorage.getItem("cata-club-enrollment-session")).toBeNull();
  });
});

// La clave de idempotencia del intento (enrollment-idempotency): vive en
// sessionStorage — MUERE al cerrar la pestaña, que es exactamente la vida del
// intento. Misma clave mientras el visitante reintenta EL MISMO intento;
// clave nueva cuando empieza OTRO alumno (`clearEnrollmentAttemptKey`).
describe("enrollment attempt key (sessionStorage)", () => {
  const KEY = "cata-club-enrollment-attempt-key";

  beforeEach(() => {
    vi.stubGlobal("sessionStorage", createMemoryStorage());
  });

  it("returns null when no attempt has minted a key yet", () => {
    expect(getEnrollmentAttemptKey()).toBeNull();
  });

  it("mints and persists one key per attempt", () => {
    const key = ensureEnrollmentAttemptKey();

    expect(key).toMatch(/^[0-9a-f-]{36}$/i);
    expect(sessionStorage.getItem(KEY)).toBe(key);
  });

  it("reuses the same key across retries of the same attempt", () => {
    const primera = ensureEnrollmentAttemptKey();
    const reintento = ensureEnrollmentAttemptKey();

    expect(reintento).toBe(primera);
    expect(sessionStorage.getItem(KEY)).toBe(primera);
  });

  it("clears the key so a new student gets a fresh attempt", () => {
    ensureEnrollmentAttemptKey();

    clearEnrollmentAttemptKey();

    expect(getEnrollmentAttemptKey()).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBeNull();
    const nueva = ensureEnrollmentAttemptKey();
    expect(nueva).not.toBe(undefined);
    expect(sessionStorage.getItem(KEY)).toBe(nueva);
  });
});