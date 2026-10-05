import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/image", () => ({
  __esModule: true,
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ unoptimized: _u, priority: _p, ...props }: Record<string, unknown>) => <img alt="" {...(props as object)} />,
}));
let mockRole: string | null = null;
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: mockRole ? { user: { role: mockRole }, roles: [] } : null }),
}));
vi.mock("../fireworks", () => ({ startFireworks: vi.fn(() => vi.fn()) }));

import LaunchCurtain, { FIREWORKS_MS, REDUCED_OPEN_MS } from "../LaunchCurtain";
import { startFireworks } from "../fireworks";
import { COUNTDOWN_FROM, LAUNCH_AT } from "@/lib/launch";

function mockMotion(reduce: boolean): void {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce && query.includes("reduce"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

describe("LaunchCurtain", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockMotion(false);
    mockRole = null;
    window.history.replaceState(null, "", "/");
    vi.mocked(startFireworks).mockClear();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    document.documentElement.classList.remove("launch-locked");
  });

  it("shows the labelled curtain with the countdown before the launch", () => {
    vi.setSystemTime(LAUNCH_AT - (25 * 60 + 4) * 1000);
    render(<LaunchCurtain launchAt={LAUNCH_AT} serverNow={Date.now()} />);
    const curtain = screen.getByRole("dialog", { name: /cuenta regresiva/i });
    expect(curtain.textContent).toContain("Gran lanzamiento · hoy 17:00");
    expect(curtain.textContent).toMatch(/00.*00.*25.*04/);
    expect(document.documentElement.classList.contains("launch-locked")).toBe(true);
  });

  it("renders nothing after the launch instant", () => {
    vi.setSystemTime(LAUNCH_AT + 1000);
    const { container } = render(<LaunchCurtain launchAt={LAUNCH_AT} serverNow={Date.now()} />);
    expect(container.firstChild).toBeNull();
    expect(document.documentElement.classList.contains("launch-locked")).toBe(false);
  });

  it("announces politely at most once per minute", () => {
    vi.setSystemTime(LAUNCH_AT - 5 * 60_000 - 500);
    render(<LaunchCurtain launchAt={LAUNCH_AT} serverNow={Date.now()} />);
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("Faltan 5 minutos para el lanzamiento.");
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(status.textContent).toBe("Faltan 5 minutos para el lanzamiento.");
    act(() => { vi.advanceTimersByTime(31_000); });
    expect(status.textContent).toBe("Faltan 4 minutos para el lanzamiento.");
  });

  it("opens at zero, plays fireworks and removes the overlay", () => {
    vi.setSystemTime(LAUNCH_AT - 3000);
    render(<LaunchCurtain launchAt={LAUNCH_AT} serverNow={Date.now()} />);
    act(() => { vi.advanceTimersByTime(3100); });
    expect(screen.getByTestId("launch-curtain").className).toContain("is-opening");
    expect(startFireworks).toHaveBeenCalledTimes(1);
    expect(document.documentElement.classList.contains("launch-locked")).toBe(false);
    act(() => { vi.advanceTimersByTime(FIREWORKS_MS + 100); });
    expect(screen.queryByTestId("launch-curtain")).toBeNull();
  });

  it("catches up after a tab sleep by reading the wall clock", () => {
    vi.setSystemTime(LAUNCH_AT - 60_000);
    render(<LaunchCurtain launchAt={LAUNCH_AT} serverNow={Date.now()} />);
    act(() => { vi.setSystemTime(LAUNCH_AT + 5000); vi.advanceTimersByTime(250); });
    expect(screen.getByTestId("launch-curtain").className).toContain("is-opening");
  });

  it("fades without fireworks under reduced motion", () => {
    mockMotion(true);
    vi.setSystemTime(LAUNCH_AT - 1000);
    render(<LaunchCurtain launchAt={LAUNCH_AT} serverNow={Date.now()} />);
    act(() => { vi.advanceTimersByTime(1100); });
    expect(screen.getByTestId("launch-curtain").className).toContain("is-reduced");
    expect(startFireworks).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(REDUCED_OPEN_MS + 50); });
    expect(screen.queryByTestId("launch-curtain")).toBeNull();
  });

  describe("before the countdown window", () => {
    it("says it is coming soon, with no numbers, before 16:30", () => {
      vi.setSystemTime(COUNTDOWN_FROM - 60_000);
      render(<LaunchCurtain launchAt={LAUNCH_AT} serverNow={Date.now()} />);
      const curtain = screen.getByRole("dialog");
      expect(curtain.textContent).toContain("Muy pronto · hoy 17:00");
      expect(curtain.textContent).not.toMatch(/Días|Horas|Minutos|Segundos/);
      expect(screen.getByRole("status").textContent).toBe("");
    });

    it("switches to the countdown live at 16:30, without a reload", () => {
      vi.setSystemTime(COUNTDOWN_FROM - 2000);
      render(<LaunchCurtain launchAt={LAUNCH_AT} serverNow={Date.now()} />);
      expect(screen.getByRole("dialog").textContent).not.toContain("Segundos");
      act(() => { vi.advanceTimersByTime(2500); });
      const curtain = screen.getByRole("dialog");
      expect(curtain.textContent).toContain("Gran lanzamiento · hoy 17:00");
      expect(curtain.textContent).toMatch(/Días.*Horas.*Minutos.*Segundos/);
      expect(screen.getByRole("status").textContent).toBe("Faltan 30 minutos para el lanzamiento.");
    });

    it("shows the countdown between 16:30 and 17:00", () => {
      vi.setSystemTime(LAUNCH_AT - 10 * 60_000);
      render(<LaunchCurtain launchAt={LAUNCH_AT} serverNow={Date.now()} />);
      expect(screen.getByRole("dialog").textContent).toMatch(/Días.*Horas.*Minutos.*Segundos/);
    });
  });

  describe("club team preview", () => {
    beforeEach(() => { vi.setSystemTime(LAUNCH_AT - 3 * 60 * 60_000); });

    it("lets an admin see the landing with a preview banner instead of curtains", () => {
      mockRole = "admin";
      render(<LaunchCurtain launchAt={LAUNCH_AT} serverNow={Date.now()} />);
      expect(screen.queryByTestId("launch-curtain")).toBeNull();
      expect(screen.getByText("Vista previa: el público ve las cortinas hasta las 17:00")).toBeTruthy();
      expect(document.documentElement.classList.contains("launch-locked")).toBe(false);
    });

    it("shows the curtains on demand and lets the admin close them again", () => {
      mockRole = "admin";
      render(<LaunchCurtain launchAt={LAUNCH_AT} serverNow={Date.now()} />);
      fireEvent.click(screen.getByRole("button", { name: "Ver como el público" }));
      expect(screen.getByTestId("launch-curtain")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Salir de la vista pública" }));
      expect(screen.queryByTestId("launch-curtain")).toBeNull();
      expect(screen.getByRole("button", { name: "Ver como el público" })).toBeTruthy();
    });

    it("forces the curtains for an admin with ?cortinas=1", () => {
      mockRole = "admin";
      window.history.replaceState(null, "", "/?cortinas=1");
      render(<LaunchCurtain launchAt={LAUNCH_AT} serverNow={Date.now()} />);
      expect(screen.getByTestId("launch-curtain")).toBeTruthy();
      expect(screen.queryByText(/Vista previa/)).toBeNull();
    });

    it.each(["estudiante", "trainer", "representante"])("keeps the curtains for a %s", (role) => {
      mockRole = role;
      render(<LaunchCurtain launchAt={LAUNCH_AT} serverNow={Date.now()} />);
      expect(screen.getByTestId("launch-curtain")).toBeTruthy();
      expect(screen.queryByText(/Vista previa/)).toBeNull();
    });

    it("drops the banner at launch without replaying the show for a previewing admin", () => {
      mockRole = "admin";
      vi.setSystemTime(LAUNCH_AT - 2000);
      render(<LaunchCurtain launchAt={LAUNCH_AT} serverNow={Date.now()} />);
      act(() => { vi.advanceTimersByTime(2500); });
      expect(screen.queryByText(/Vista previa/)).toBeNull();
      expect(screen.queryByTestId("launch-curtain")).toBeNull();
      expect(startFireworks).not.toHaveBeenCalled();
    });
  });
});
