/**
 * A remembered filter has to survive a reload and refuse a stale value.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { preferenceKey, usePersistentPreference } from "../persistent-preference";

type Filter = "pendiente" | "validado" | "rechazado";
const FILTERS: Filter[] = ["pendiente", "validado", "rechazado"];
const isFilter = (value: string): value is Filter => (FILTERS as string[]).includes(value);

const NAME = "payments-queue-filter";

/**
 * Node's jsdom here ships no `localStorage` (the experimental global needs
 * `--localstorage-file`), so the same in-memory stub the shell and enrolment
 * tests use stands in — the real get/set contract, exercised for real.
 */
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

beforeEach(() => {
  vi.stubGlobal("localStorage", createMemoryStorage());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPreference(fallback: Filter = "pendiente") {
  return renderHook(() => usePersistentPreference<Filter>(NAME, fallback, isFilter));
}

describe("usePersistentPreference", () => {
  it("starts on the fallback when the user has never chosen", () => {
    const { result } = renderPreference();

    expect(result.current[0]).toBe("pendiente");
  });

  it("remembers the choice for the next visit", async () => {
    const first = renderPreference();

    act(() => first.result.current[1]("rechazado"));
    expect(first.result.current[0]).toBe("rechazado");

    // A new day, a new page load.
    first.unmount();
    const next = renderPreference();

    await waitFor(() => expect(next.result.current[0]).toBe("rechazado"));
  });

  it("writes under a namespaced key", () => {
    const { result } = renderPreference();

    act(() => result.current[1]("validado"));

    expect(window.localStorage.getItem(preferenceKey(NAME))).toBe("validado");
    expect(preferenceKey(NAME)).toMatch(/^cata:pref:/);
  });

  it("ignores a stored value the product no longer understands", async () => {
    // A filter key renamed in a later release, or someone editing devtools.
    // Restoring it would filter by a state that does not exist: an empty
    // screen with a pill highlighted that is not in the list.
    window.localStorage.setItem(preferenceKey(NAME), "PENDIENTE_VALIDACION");

    const { result } = renderPreference();

    await waitFor(() => expect(result.current[0]).toBe("pendiente"));
  });

  it("ignores an empty stored value", async () => {
    window.localStorage.setItem(preferenceKey(NAME), "");

    const { result } = renderPreference();

    await waitFor(() => expect(result.current[0]).toBe("pendiente"));
  });

  it("keeps two different preferences apart", async () => {
    const queue = renderHook(() => usePersistentPreference<Filter>("a", "pendiente", isFilter));
    const other = renderHook(() => usePersistentPreference<Filter>("b", "pendiente", isFilter));

    act(() => queue.result.current[1]("validado"));

    await waitFor(() => expect(queue.result.current[0]).toBe("validado"));
    expect(other.result.current[0]).toBe("pendiente");
  });

  it("survives storage being unavailable", () => {
    const original = window.localStorage.setItem;
    window.localStorage.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    try {
      const { result } = renderPreference();

      // The choice still applies to this session; only the memory is lost.
      expect(() => act(() => result.current[1]("validado"))).not.toThrow();
      expect(result.current[0]).toBe("validado");
    } finally {
      window.localStorage.setItem = original;
    }
  });
});
