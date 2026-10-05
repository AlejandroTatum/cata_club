/**
 * LegalReacceptGate — S8: an account whose latest accepted terms are older
 * than the current version must review and accept them before using the app.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockUseAuth = vi.fn();
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => mockUseAuth() }));

import LegalReacceptGate from "@/components/legal/LegalReacceptGate";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const logout = vi.fn();

beforeEach(() => {
  logout.mockReset();
  mockUseAuth.mockReturnValue({ isAuthenticated: true, session: { user: { id: "7" } }, logout });
  vi.spyOn(global, "fetch");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LegalReacceptGate", () => {
  it("shows the blocking review dialog when acceptance is pending", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(json({ pendiente: true, version: "2.3" }));
    render(<LegalReacceptGate />);

    const dialog = await screen.findByRole("dialog", { name: /términos y condiciones/i });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /acepto/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^cerrar$/i })).not.toBeInTheDocument();
  });

  it("renders nothing when nothing is pending", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(json({ pendiente: false, version: "2.3" }));
    render(<LegalReacceptGate />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not ask the backend while signed out", () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: false, session: null, logout });
    render(<LegalReacceptGate />);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("posts the acceptance and hides the dialog afterwards", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(json({ pendiente: true, version: "2.3" }))
      .mockResolvedValueOnce(json({ pendiente: false, version: "2.3" }));
    render(<LegalReacceptGate />);

    fireEvent.click(await screen.findByRole("button", { name: /acepto/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(vi.mocked(global.fetch).mock.calls[1][0]).toBe("/api/auth/consentimiento-legal/aceptar");
    expect(vi.mocked(global.fetch).mock.calls[1][1]).toEqual(expect.objectContaining({ method: "POST" }));
  });

  it("keeps the dialog and reports the failure when accepting fails", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(json({ pendiente: true, version: "2.3" }))
      .mockResolvedValueOnce(json({ message: "boom" }, 500));
    render(<LegalReacceptGate />);

    fireEvent.click(await screen.findByRole("button", { name: /acepto/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("lets the user sign out instead of accepting", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(json({ pendiente: true, version: "2.3" }));
    render(<LegalReacceptGate />);

    fireEvent.click(await screen.findByRole("button", { name: /cerrar sesión/i }));

    expect(logout).toHaveBeenCalledTimes(1);
  });
});
