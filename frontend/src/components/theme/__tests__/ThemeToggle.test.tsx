/**
 * The dark-mode control: visible, labelled, pressed-state aware, persistent.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { act, fireEvent, render, screen } from "@testing-library/react";
import ThemeToggle from "../ThemeToggle";
import ThemeScript from "../ThemeScript";
import { THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from "@/lib/theme";

function memoryStorage(): Storage {
  const store: Record<string, string> = {};
  return {
    getItem: (key: string): string | null => (key in store ? store[key] : null),
    setItem: (key: string, value: string): void => {
      store[key] = String(value);
    },
    removeItem: (key: string): void => {
      delete store[key];
    },
    clear: (): void => undefined,
    key: (): string | null => null,
    length: 0,
  } as Storage;
}

describe("ThemeToggle", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    document.documentElement.setAttribute("data-theme", "light");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute("data-theme");
  });

  it("is a button with a constant name and aria-pressed for its state", () => {
    render(<ThemeToggle variant="bar" />);
    const button = screen.getByRole("button", { name: "Modo oscuro" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("switches to dark, flips aria-pressed and persists the choice", async () => {
    render(<ThemeToggle variant="bar" />);
    const button = screen.getByRole("button", { name: "Modo oscuro" });

    await act(async () => {
      fireEvent.click(button);
    });

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    await act(async () => {
      fireEvent.click(button);
    });
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("starts pressed when the page is already dark (the pre-paint script ran)", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    render(<ThemeToggle variant="bar" />);
    expect(screen.getByRole("button", { name: "Modo oscuro" })).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps every toggle on the page in step (top bar and account menu)", async () => {
    render(
      <>
        <ThemeToggle variant="bar" />
        <ThemeToggle variant="menu" />
      </>,
    );
    const [bar, menu] = screen.getAllByRole("button", { name: "Modo oscuro" });

    await act(async () => {
      fireEvent.click(bar);
    });

    expect(menu).toHaveAttribute("aria-pressed", "true");
    expect(menu).toHaveTextContent("Modo claro");
  });

  it("still switches for the page when storage is blocked", () => {
    vi.stubGlobal("localStorage", {
      getItem: (): null => null,
      setItem: (): never => {
        throw new Error("blocked");
      },
    });
    render(<ThemeToggle variant="bar" />);
    expect(() => fireEvent.click(screen.getByRole("button", { name: "Modo oscuro" }))).not.toThrow();
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });
});

describe("ThemeScript", () => {
  it("renders an inline script carrying the CSP nonce and the init code", () => {
    const html = renderToStaticMarkup(<ThemeScript nonce="n0nce-123" />);
    expect(html).toContain('nonce="n0nce-123"');
    expect(html).toContain(THEME_INIT_SCRIPT);
  });

  it("renders without a nonce attribute when the request had none", () => {
    expect(renderToStaticMarkup(<ThemeScript />)).not.toContain("nonce=");
  });
});
