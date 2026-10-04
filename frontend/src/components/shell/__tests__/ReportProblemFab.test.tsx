import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ReportProblemFab from "../ReportProblemFab";
import { keepNode } from "../../report-problem/capture";

const mockPathname = vi.hoisted(() => ({ value: "/dashboard" }));
const mockSession = vi.hoisted(() => ({ value: { user: { role: "admin" } } as unknown }));
const captureViewport = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ usePathname: (): string => mockPathname.value }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: (): { session: unknown } => ({ session: mockSession.value }) }));
vi.mock("../../report-problem/capture", async (original) => ({
  ...(await original<typeof import("../../report-problem/capture")>()),
  captureViewport,
}));

afterEach((): void => {
  mockPathname.value = "/dashboard";
  mockSession.value = { user: { role: "admin" } };
  captureViewport.mockReset();
  document.body.innerHTML = "";
});

describe("ReportProblemFab", (): void => {
  it.each(["/dashboard", "/student", "/trainer/attendance", "/admin/reportes-error", "/profile"])(
    "shows the named button on signed-in app route %s",
    (route): void => {
      mockPathname.value = route;
      render(<ReportProblemFab />);
      expect(screen.getByRole("button", { name: "Reportar un problema" })).toBeInTheDocument();
    },
  );

  it.each(["/", "/terminos", "/login", "/forgot-password", "/verificar-correo", "/student/enroll"])(
    "is absent on non-app route %s",
    (route): void => {
      mockPathname.value = route;
      render(<ReportProblemFab />);
      expect(screen.queryByRole("button", { name: "Reportar un problema" })).not.toBeInTheDocument();
    },
  );

  it("is absent without a session, even on an app route", (): void => {
    mockSession.value = null;
    mockPathname.value = "/ayuda";
    render(<ReportProblemFab />);
    expect(screen.queryByRole("button", { name: "Reportar un problema" })).not.toBeInTheDocument();
  });

  it("captures the screen, then opens the report dialog", async (): Promise<void> => {
    captureViewport.mockResolvedValue(new File(["x"], "captura-pantalla.jpg", { type: "image/jpeg" }));
    render(<ReportProblemFab />);
    fireEvent.click(screen.getByRole("button", { name: "Reportar un problema" }));
    expect(await screen.findByRole("dialog", { name: "Reportar un problema" })).toBeInTheDocument();
    expect(captureViewport).toHaveBeenCalledTimes(1);
    // The launcher steps aside while the dialog is up.
    expect(screen.queryByRole("button", { name: "Reportar un problema" })).not.toBeInTheDocument();
  });

  it("is excluded from the screen capture and meets the touch target", (): void => {
    render(<ReportProblemFab />);
    const button = screen.getByRole("button", { name: "Reportar un problema" });
    expect(keepNode(button)).toBe(false);
    expect(button.className).toMatch(/min-h-\[44px\]/);
    expect(button.className).toMatch(/focus-visible:/);
  });

  it("hides while another modal dialog is open and returns when it closes", async (): Promise<void> => {
    render(<ReportProblemFab />);
    const modal = document.createElement("div");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    await act(async (): Promise<void> => { document.body.appendChild(modal); });
    await waitFor((): void => {
      expect(screen.queryByRole("button", { name: "Reportar un problema" })).not.toBeInTheDocument();
    });
    await act(async (): Promise<void> => { modal.remove(); });
    await waitFor((): void => {
      expect(screen.getByRole("button", { name: "Reportar un problema" })).toBeInTheDocument();
    });
  });
});
