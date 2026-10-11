/**
 * WhatsNewDialog — the once-per-release note shown after login.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const mockUseAuth = vi.fn();
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => mockUseAuth() }));

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import WhatsNewDialog from "@/components/WhatsNewDialog";
import { publishLegalGateStatus } from "@/components/legal/legal-gate-status";
import { WHATS_NEW_ITEMS, WHATS_NEW_STORAGE_KEY, WHATS_NEW_VERSION } from "@/lib/whats-new/content";
import { resetWhatsNewSessionForTests } from "@/lib/whats-new/use-whats-new";
import { createMemoryStorage } from "@/lib/whats-new/__tests__/memory-storage";

function signedInAs(backendRoles: string[], role = "admin"): void {
  mockUseAuth.mockReturnValue({
    isAuthenticated: true,
    isLoading: false,
    session: { user: { id: "1", role }, roles: backendRoles },
  });
}

function bulletTexts(): string[] {
  return screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
}

beforeEach(() => {
  vi.stubGlobal("localStorage", createMemoryStorage());
  resetWhatsNewSessionForTests();
  publishLegalGateStatus("clear");
  signedInAs(["ADMINISTRADOR"]);
});

afterEach(() => {
  cleanup();
  publishLegalGateStatus("unknown");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("WhatsNewDialog", () => {
  it("shows on the first visit with the header", () => {
    render(<WhatsNewDialog />);
    const dialog = screen.getByRole("dialog", { name: "CataClub se renovó" });
    expect(dialog).toHaveAccessibleDescription(
      "Le dimos una nueva imagen al sistema para que sea más claro y cómodo de usar, sobre todo desde el celular. Ahora las ventanas y los avisos aparecen con más suavidad.",
    );
  });

  it("closes with Entendido, remembers the version and stays closed on the next mount", () => {
    const { unmount } = render(<WhatsNewDialog />);
    fireEvent.click(screen.getByRole("button", { name: "Entendido" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(window.localStorage.getItem(WHATS_NEW_STORAGE_KEY)).toBe(WHATS_NEW_VERSION);

    unmount();
    resetWhatsNewSessionForTests();
    render(<WhatsNewDialog />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows again when a release bumps the version", () => {
    window.localStorage.setItem(WHATS_NEW_STORAGE_KEY, "previous-release");
    render(<WhatsNewDialog />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("marks the version as seen on Escape and on the backdrop", () => {
    const first = render(<WhatsNewDialog />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(window.localStorage.getItem(WHATS_NEW_STORAGE_KEY)).toBe(WHATS_NEW_VERSION);
    first.unmount();

    window.localStorage.clear();
    resetWhatsNewSessionForTests();
    render(<WhatsNewDialog />);
    fireEvent.click(screen.getByTestId("whats-new-backdrop"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(window.localStorage.getItem(WHATS_NEW_STORAGE_KEY)).toBe(WHATS_NEW_VERSION);
  });

  it("Ver ayuda marks it seen and points at /ayuda", () => {
    render(<WhatsNewDialog />);
    const help = screen.getByRole("link", { name: "Ver ayuda" });
    expect(help).toHaveAttribute("href", "/ayuda");
    fireEvent.click(help);
    expect(window.localStorage.getItem(WHATS_NEW_STORAGE_KEY)).toBe(WHATS_NEW_VERSION);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("lists the admin bullets verbatim, with a bold lead before the colon", () => {
    render(<WhatsNewDialog />);
    expect(bulletTexts()).toEqual([...WHATS_NEW_ITEMS.admin]);
    expect(bulletTexts()[0]).toBe("Modo oscuro: actívalo desde tu menú de cuenta, también en el inicio de sesión.");
    const strong = screen.getAllByRole("listitem")[0].querySelector("strong");
    expect(strong?.textContent).toBe("Modo oscuro:");
    // The approved copy bolds the leading question too.
    expect(screen.getAllByRole("listitem")[4].querySelector("strong")?.textContent).toBe("¿Algo no anda?");
  });

  it("lists the entrenador bullets for a trainer", () => {
    signedInAs(["ENTRENADOR"], "trainer");
    render(<WhatsNewDialog />);
    expect(bulletTexts()).toEqual([
      "Modo oscuro: actívalo desde tu menú de cuenta.",
      "Tu lista y tus grupos, más livianos: filas más compactas y fáciles de leer.",
      "Mejor en el celular: botones más grandes y más fáciles de tocar.",
      "¿Algo no anda? El botón para reportar un problema está siempre arriba, en la barra.",
    ]);
  });

  it.each([
    [["ALUMNO"], "estudiante"],
    [["REPRESENTANTE"], "representante"],
  ])("lists the shared estudiante/representante bullets for %s", (backendRoles, role) => {
    signedInAs(backendRoles, role);
    render(<WhatsNewDialog />);
    expect(bulletTexts()).toEqual([
      "Modo oscuro: actívalo desde tu menú de cuenta.",
      "Tu panel, de un vistazo: tu membresía y tus números importantes se ven claros apenas entras.",
      "Pagos más claros: el estado de cada pago se entiende sin tener que abrirlo.",
      "Mejor en el celular: botones más grandes y pantallas más ordenadas.",
    ]);
  });

  it("gives a user with several roles the highest-priority list", () => {
    signedInAs(["ALUMNO", "ENTRENADOR", "ADMINISTRADOR"], "admin");
    render(<WhatsNewDialog />);
    expect(bulletTexts()).toEqual([...WHATS_NEW_ITEMS.admin]);
  });

  it("shows only the header and the button for an unknown role", () => {
    signedInAs(["SOMETHING_NEW"], "unsupported");
    render(<WhatsNewDialog />);
    expect(screen.getByRole("dialog", { name: "CataClub se renovó" })).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Entendido" })).toBeInTheDocument();
  });

  it("does not throw or show when localStorage is unavailable, and does not loop", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => render(<WhatsNewDialog />)).not.toThrow();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("stays closed this session when saving fails, even after a remount", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const { unmount } = render(<WhatsNewDialog />);
    expect(() => fireEvent.click(screen.getByRole("button", { name: "Entendido" }))).not.toThrow();
    unmount();
    render(<WhatsNewDialog />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("waits for the legal gate, then shows once it is resolved", () => {
    publishLegalGateStatus("pending");
    render(<WhatsNewDialog />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    act(() => publishLegalGateStatus("clear"));
    expect(screen.getByRole("dialog", { name: "CataClub se renovó" })).toBeInTheDocument();
  });

  it("does not show before the legal gate has answered", () => {
    publishLegalGateStatus("unknown");
    render(<WhatsNewDialog />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not show to a signed-out visitor", () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: false, isLoading: false, session: null });
    render(<WhatsNewDialog />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
