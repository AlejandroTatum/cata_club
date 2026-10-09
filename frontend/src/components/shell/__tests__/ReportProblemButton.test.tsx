import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ReportProblemButton from "../ReportProblemButton";
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

describe("ReportProblemButton", (): void => {
  it.each(["/dashboard", "/student", "/trainer/attendance", "/admin/reportes-error", "/profile"])(
    "shows the named button on signed-in app route %s",
    (route): void => {
      mockPathname.value = route;
      render(<ReportProblemButton />);
      expect(screen.getByRole("button", { name: "Reportar un problema" })).toBeInTheDocument();
    },
  );

  it.each(["/", "/terminos", "/login", "/forgot-password", "/verificar-correo", "/student/enroll"])(
    "is absent on non-app route %s",
    (route): void => {
      mockPathname.value = route;
      render(<ReportProblemButton />);
      expect(screen.queryByRole("button", { name: "Reportar un problema" })).not.toBeInTheDocument();
    },
  );

  it("is absent without a session, even on an app route", (): void => {
    mockSession.value = null;
    mockPathname.value = "/ayuda";
    render(<ReportProblemButton />);
    expect(screen.queryByRole("button", { name: "Reportar un problema" })).not.toBeInTheDocument();
  });

  it("captures the screen, then opens the report dialog", async (): Promise<void> => {
    captureViewport.mockResolvedValue(new File(["x"], "captura-pantalla.jpg", { type: "image/jpeg" }));
    render(<ReportProblemButton />);
    fireEvent.click(screen.getByRole("button", { name: "Reportar un problema" }));
    expect(await screen.findByRole("dialog", { name: "Reportar un problema" })).toBeInTheDocument();
    expect(captureViewport).toHaveBeenCalledTimes(1);
  });

  it("is excluded from the screen capture and meets the touch-target floor", (): void => {
    render(<ReportProblemButton />);
    const button = screen.getByRole("button", { name: "Reportar un problema" });
    expect(keepNode(button)).toBe(false);
    expect(button.className).toMatch(/touch-target/);
  });

  it("stays mounted while the dialog is up, so focus can return to it", async (): Promise<void> => {
    captureViewport.mockResolvedValue(new File(["x"], "captura-pantalla.jpg", { type: "image/jpeg" }));
    render(<ReportProblemButton />);
    fireEvent.click(screen.getByRole("button", { name: "Reportar un problema" }));
    await screen.findByRole("dialog", { name: "Reportar un problema" });
    expect(screen.getAllByRole("button", { name: "Reportar un problema" }).length).toBeGreaterThan(0);
  });
});

describe("ReportProblemButton — never covers content (T14 RC4)", (): void => {
  it("sits in the flow, not fixed over the page", (): void => {
    render(<ReportProblemButton />);
    const button = screen.getByRole("button", { name: "Reportar un problema" });
    expect(button.className).not.toMatch(/\b(fixed|absolute|sticky)\b/);
    expect(button.style.bottom).toBe("");
  });

  it("is an icon below lg and keeps its accessible name", (): void => {
    render(<ReportProblemButton />);
    const button = screen.getByRole("button", { name: "Reportar un problema" });
    expect(button).toHaveAttribute("title", "Reportar un problema");
    expect(button.className).toMatch(/max-lg:w-11/);
    expect(button.querySelector("span")?.className).toMatch(/max-lg:sr-only/);
  });
});
