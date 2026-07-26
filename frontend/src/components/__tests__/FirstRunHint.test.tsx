/**
 * A hint that comes back is worse than no hint at all.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import FirstRunHint, { hintKey } from "@/components/FirstRunHint";

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

function renderHint(id = "nivel-ladder") {
  return render(<FirstRunHint id={id}>El nivel 1 es la cima.</FirstRunHint>);
}

describe("FirstRunHint", () => {
  it("explains the rule on a first visit", async () => {
    renderHint();

    expect(await screen.findByText("El nivel 1 es la cima.")).toBeInTheDocument();
  });

  it("never comes back once dismissed", async () => {
    renderHint();
    fireEvent.click(await screen.findByRole("button", { name: /no mostrar de nuevo/i }));

    expect(screen.queryByText("El nivel 1 es la cima.")).not.toBeInTheDocument();

    cleanup();
    renderHint();

    // Give the reveal effect every chance to run before declaring it absent.
    await waitFor(() => expect(localStorage.getItem(hintKey("nivel-ladder"))).toBe("1"));
    expect(screen.queryByText("El nivel 1 es la cima.")).not.toBeInTheDocument();
  });

  it("keeps two different hints independent", async () => {
    render(<FirstRunHint id="a">Primera regla.</FirstRunHint>);
    await screen.findByText("Primera regla.");
    fireEvent.click(screen.getByRole("button", { name: /no mostrar de nuevo/i }));

    cleanup();
    render(<FirstRunHint id="b">Segunda regla.</FirstRunHint>);

    expect(await screen.findByText("Segunda regla.")).toBeInTheDocument();
  });

  it("shows nothing rather than forever when storage is unavailable", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
    });

    renderHint();

    // A hint that cannot remember being dismissed would reappear on every
    // page load; not showing it is the smaller failure.
    await waitFor(() =>
      expect(screen.queryByText("El nivel 1 es la cima.")).not.toBeInTheDocument(),
    );
  });

  it("does not flash for a returning user before storage is read", () => {
    localStorage.setItem(hintKey("nivel-ladder"), "1");

    renderHint();

    // Synchronously, before any effect: nothing on screen.
    expect(screen.queryByText("El nivel 1 es la cima.")).not.toBeInTheDocument();
  });
});
