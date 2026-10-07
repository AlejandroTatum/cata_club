/**
 * LegalReacceptGate — S8: an account whose latest accepted terms are older
 * than the current version must review and accept them before using the app.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockUseAuth = vi.fn();
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => mockUseAuth() }));

const reloadPage = vi.fn();
vi.mock("@/components/legal/reload-page", () => ({ reloadPage: () => reloadPage() }));

import LegalReacceptGate from "@/components/legal/LegalReacceptGate";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const logout = vi.fn();
let fetchSpy: MockInstance<typeof fetch>;

beforeEach(() => {
  logout.mockReset();
  reloadPage.mockReset();
  mockUseAuth.mockReturnValue({ isAuthenticated: true, session: { user: { id: "7" } }, logout });
  fetchSpy = vi.spyOn(global, "fetch");
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("LegalReacceptGate", () => {
  it("shows the blocking review dialog when acceptance is pending", async () => {
    fetchSpy.mockResolvedValueOnce(json({ pendiente: true, version: "2.3" }));
    render(<LegalReacceptGate />);

    const dialog = await screen.findByRole("dialog", { name: /términos y condiciones/i });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /acepto/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^cerrar$/i })).not.toBeInTheDocument();
  });

  it("renders nothing when nothing is pending", async () => {
    fetchSpy.mockResolvedValueOnce(json({ pendiente: false, version: "2.3" }));
    render(<LegalReacceptGate />);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not ask the backend while signed out", () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: false, session: null, logout });
    render(<LegalReacceptGate />);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("posts the acceptance and hides the dialog afterwards", async () => {
    fetchSpy
      .mockResolvedValueOnce(json({ pendiente: true, version: "2.3" }))
      .mockResolvedValueOnce(json({ pendiente: false, version: "2.3" }));
    render(<LegalReacceptGate />);

    fireEvent.click(await screen.findByRole("button", { name: /acepto/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(fetchSpy.mock.calls[1][0]).toBe("/api/auth/consentimiento-legal/aceptar");
    expect(fetchSpy.mock.calls[1][1]).toEqual(expect.objectContaining({ method: "POST" }));
  });

  it("keeps the dialog and reports the failure when accepting fails", async () => {
    fetchSpy
      .mockResolvedValueOnce(json({ pendiente: true, version: "2.3" }))
      .mockResolvedValueOnce(json({ message: "boom" }, 500));
    render(<LegalReacceptGate />);

    fireEvent.click(await screen.findByRole("button", { name: /acepto/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("lets the user sign out instead of accepting", async () => {
    fetchSpy.mockResolvedValueOnce(json({ pendiente: true, version: "2.3" }));
    render(<LegalReacceptGate />);

    fireEvent.click(await screen.findByRole("button", { name: /cerrar sesión/i }));

    expect(logout).toHaveBeenCalledTimes(1);
  });
  it("reloads the page after accepting so every blocked request is refetched", async () => {
    fetchSpy
      .mockResolvedValueOnce(json({ pendiente: true, version: "2.3" }))
      .mockResolvedValueOnce(json({ pendiente: false, version: "2.3" }));
    render(<LegalReacceptGate />);

    fireEvent.click(await screen.findByRole("button", { name: /acepto/i }));

    await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1));
  });

  it("opens the dialog when any later request is blocked with the re-acceptance code", async () => {
    fetchSpy
      .mockResolvedValueOnce(json({ pendiente: false, version: "2.3" }))
      .mockResolvedValueOnce(json({ message: "Debes aceptar.", codigo: "reaceptacion_legal_pendiente" }, 403));
    render(<LegalReacceptGate />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const blocked = await window.fetch("/api/members");

    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toEqual(expect.objectContaining({ codigo: "reaceptacion_legal_pendiente" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("ignores a 403 without the re-acceptance code", async () => {
    fetchSpy
      .mockResolvedValueOnce(json({ pendiente: false, version: "2.3" }))
      .mockResolvedValueOnce(json({ message: "No autorizado" }, 403));
    render(<LegalReacceptGate />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());

    await window.fetch("/api/members");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("retries a failed status check instead of leaving the account unchecked", async () => {
    vi.useFakeTimers();
    fetchSpy
      .mockRejectedValueOnce(new TypeError("network"))
      .mockResolvedValueOnce(json({ pendiente: true, version: "2.3" }));
    render(<LegalReacceptGate />);

    await vi.advanceTimersByTimeAsync(0);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(fetchSpy.mock.calls.length).toBe(2);
  });

  it("keeps sign-out reachable when the dialog was opened by a blocked request", async () => {
    fetchSpy
      .mockResolvedValueOnce(json({ pendiente: false, version: "2.3" }))
      .mockResolvedValueOnce(json({ codigo: "reaceptacion_legal_pendiente" }, 403));
    render(<LegalReacceptGate />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    await window.fetch("/api/members");

    fireEvent.click(await screen.findByRole("button", { name: /cerrar sesión/i }));

    expect(logout).toHaveBeenCalledTimes(1);
  });
});
