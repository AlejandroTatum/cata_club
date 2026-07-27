/**
 * The guarantees a held mutation has to keep.
 *
 * Holding a request so it can be undone is only safe if it can never be
 * silently dropped and never sent twice. These tests pin both, plus the
 * ordering rule that keeps two quick decisions from reaching the server
 * backwards.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useDeferredCommit, UNDO_WINDOW_MS } from "../deferred-commit";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function request(overrides: Partial<Parameters<ReturnType<typeof useDeferredCommit>["schedule"]>[0]> = {}) {
  return {
    label: "Aprobación de Juan Pérez",
    commit: vi.fn().mockResolvedValue(undefined),
    onUndo: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
}

describe("useDeferredCommit", () => {
  it("does not send anything while the window is open", () => {
    const { result } = renderHook(() => useDeferredCommit());
    const first = request();

    act(() => result.current.schedule(first));
    act(() => void vi.advanceTimersByTime(UNDO_WINDOW_MS - 1));

    expect(first.commit).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(true);
    // A toast dismisses itself; the hold has to be visible for as long as it
    // actually lasts, so the label travels with it.
    expect(result.current.pendingLabel).toBe("Aprobación de Juan Pérez");
  });

  it("sends it once the window closes", () => {
    const { result } = renderHook(() => useDeferredCommit());
    const first = request();

    act(() => result.current.schedule(first));
    act(() => void vi.advanceTimersByTime(UNDO_WINDOW_MS));

    expect(first.commit).toHaveBeenCalledTimes(1);
    expect(result.current.isPending).toBe(false);
    expect(result.current.pendingLabel).toBeNull();
  });

  it("cancels the request entirely on undo — the server never hears about it", () => {
    const { result } = renderHook(() => useDeferredCommit());
    const first = request();

    act(() => result.current.schedule(first));
    act(() => result.current.undo());
    act(() => void vi.advanceTimersByTime(UNDO_WINDOW_MS * 2));

    expect(first.commit).not.toHaveBeenCalled();
    expect(first.onUndo).toHaveBeenCalledTimes(1);
  });

  it("ignores an undo when nothing is held", () => {
    const { result } = renderHook(() => useDeferredCommit());

    expect(() => act(() => result.current.undo())).not.toThrow();
  });

  it("flushes the previous decision before holding the next one", () => {
    // Two quick approvals must reach the server in the order they were made.
    const { result } = renderHook(() => useDeferredCommit());
    const first = request();
    const second = request();

    act(() => result.current.schedule(first));
    act(() => result.current.schedule(second));

    expect(first.commit).toHaveBeenCalledTimes(1);
    expect(second.commit).not.toHaveBeenCalled();
  });

  it("undoing after a second decision only takes back the second", () => {
    const { result } = renderHook(() => useDeferredCommit());
    const first = request();
    const second = request();

    act(() => result.current.schedule(first));
    act(() => result.current.schedule(second));
    act(() => result.current.undo());

    expect(first.commit).toHaveBeenCalledTimes(1);
    expect(first.onUndo).not.toHaveBeenCalled();
    expect(second.commit).not.toHaveBeenCalled();
    expect(second.onUndo).toHaveBeenCalledTimes(1);
  });

  it("commits rather than discards when the screen goes away", () => {
    // The admin saw "Pago aprobado". Walking away means they meant it.
    const { result, unmount } = renderHook(() => useDeferredCommit());
    const first = request();

    act(() => result.current.schedule(first));
    unmount();

    expect(first.commit).toHaveBeenCalledTimes(1);
    expect(first.onUndo).not.toHaveBeenCalled();
  });

  it("commits when the tab is being disposed of", () => {
    const { result } = renderHook(() => useDeferredCommit());
    const first = request();

    act(() => result.current.schedule(first));
    act(() => void window.dispatchEvent(new Event("pagehide")));

    expect(first.commit).toHaveBeenCalledTimes(1);
  });

  it("never sends the same request twice", () => {
    const { result, unmount } = renderHook(() => useDeferredCommit());
    const first = request();

    act(() => result.current.schedule(first));
    act(() => result.current.flush());
    act(() => void vi.advanceTimersByTime(UNDO_WINDOW_MS * 2));
    unmount();

    expect(first.commit).toHaveBeenCalledTimes(1);
  });

  it("hands a late failure back to the caller, since no button is left to hold it", async () => {
    const { result } = renderHook(() => useDeferredCommit());
    const boom = new Error("500");
    const first = request({ commit: vi.fn().mockRejectedValue(boom) });

    act(() => result.current.schedule(first));
    await act(async () => {
      vi.advanceTimersByTime(UNDO_WINDOW_MS);
    });

    expect(first.onError).toHaveBeenCalledWith(boom);
  });
});
