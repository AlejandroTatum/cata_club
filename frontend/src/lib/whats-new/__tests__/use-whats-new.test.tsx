/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { WHATS_NEW_STORAGE_KEY, WHATS_NEW_VERSION } from "../content";
import { resetWhatsNewSessionForTests, useWhatsNew } from "../use-whats-new";
import { createMemoryStorage } from "./memory-storage";

beforeEach(() => {
  vi.stubGlobal("localStorage", createMemoryStorage());
  resetWhatsNewSessionForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useWhatsNew", () => {
  it("opens on the first visit", () => {
    const { result } = renderHook(() => useWhatsNew(true));
    expect(result.current.open).toBe(true);
  });

  it("stays closed until the shell says it is ready", () => {
    const { result, rerender } = renderHook(({ ready }) => useWhatsNew(ready), {
      initialProps: { ready: false },
    });
    expect(result.current.open).toBe(false);
    rerender({ ready: true });
    expect(result.current.open).toBe(true);
  });

  it("does not open again after being dismissed", () => {
    const first = renderHook(() => useWhatsNew(true));
    act(() => first.result.current.dismiss());
    expect(first.result.current.open).toBe(false);
    expect(window.localStorage.getItem(WHATS_NEW_STORAGE_KEY)).toBe(WHATS_NEW_VERSION);

    first.unmount();
    resetWhatsNewSessionForTests();
    const second = renderHook(() => useWhatsNew(true));
    expect(second.result.current.open).toBe(false);
  });

  it("opens again when the stored version is not the current one", () => {
    window.localStorage.setItem(WHATS_NEW_STORAGE_KEY, "an-older-release");
    const { result } = renderHook(() => useWhatsNew(true));
    expect(result.current.open).toBe(true);
  });

  it("stays closed when the current version was already seen", () => {
    window.localStorage.setItem(WHATS_NEW_STORAGE_KEY, WHATS_NEW_VERSION);
    const { result } = renderHook(() => useWhatsNew(true));
    expect(result.current.open).toBe(false);
  });

  it("does not throw or show when reading storage fails", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const { result } = renderHook(() => useWhatsNew(true));
    expect(result.current.open).toBe(false);
  });

  it("does not throw nor loop when writing storage fails", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const first = renderHook(() => useWhatsNew(true));
    expect(first.result.current.open).toBe(true);
    expect(() => act(() => first.result.current.dismiss())).not.toThrow();
    expect(first.result.current.open).toBe(false);

    // The next screen mounts the shell again: still not shown this session.
    first.unmount();
    const second = renderHook(() => useWhatsNew(true));
    expect(second.result.current.open).toBe(false);
  });
});
