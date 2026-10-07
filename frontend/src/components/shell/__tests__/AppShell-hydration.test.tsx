/**
 * AppShell must hydrate cleanly when a collapsed preference is stored.
 *
 * The server cannot read `localStorage`, so its HTML is always the expanded
 * rail. A client whose FIRST render already reads "collapsed" disagrees with
 * that HTML and React discards the hydration (error #418). The stored value
 * has to be applied after mount instead.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import AppShell from "@/components/shell/AppShell";

vi.mock("next/navigation", () => ({
  usePathname: (): string => "/dashboard",
  useRouter: (): { push: () => void } => ({ push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }): React.ReactElement => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/image", () => ({
  __esModule: true,
  default: ({ fill, priority, sizes, ...rest }: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; priority?: boolean }): React.ReactElement => {
    void fill;
    void priority;
    void sizes;
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt="" {...rest} />;
  },
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: vi.fn() }));

vi.mock("@/services/api", () => ({
  fetchNotificaciones: vi.fn().mockResolvedValue({ items: [], total: 0, skip: 0, limit: 20 }),
  marcarNotificacionLeida: vi.fn().mockResolvedValue(undefined),
}));

import { useAuth } from "@/contexts/AuthContext";
import { createAuthenticatedAuth } from "@/components/__tests__/test-utils";

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

describe("AppShell hydration", (): void => {
  beforeEach((): void => {
    vi.mocked(useAuth).mockReturnValue(createAuthenticatedAuth("admin", "Admin Cata Club"));
    vi.stubGlobal("localStorage", createMemoryStorage());
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach((): void => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("hydrates without a mismatch, then restores the stored collapsed preference", async (): Promise<void> => {
    // Server pass: nothing in storage, exactly what the server sees.
    const html = renderToString(<AppShell title="Dashboard">{null}</AppShell>);
    expect(html).toContain("Colapsar menú");

    // Client pass: the browser has a stored preference.
    localStorage.setItem("cata_sidebar_collapsed", "true");
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const errors = vi.spyOn(console, "error").mockImplementation((): void => undefined);

    let root!: ReturnType<typeof hydrateRoot>;
    await act(async (): Promise<void> => {
      root = hydrateRoot(container, <AppShell title="Dashboard">{null}</AppShell>);
    });

    expect(errors.mock.calls.map((c) => String(c[0]))).toEqual([]);
    // Preference restored after mount.
    expect(container.querySelector("aside")).toHaveClass("lg:w-[76px]");
    expect(container.querySelector('button[aria-label="Expandir menú"]')).not.toBeNull();

    await act(async (): Promise<void> => root.unmount());
    container.remove();
  });
});
