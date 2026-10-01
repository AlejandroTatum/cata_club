/**
 * "Actividad del club" — admin-only, read-only, fed by demo fixtures.
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import ActividadPage from "../page";
import { useAuth } from "@/contexts/AuthContext";
import { createAuthenticatedAuth } from "@/components/__tests__/test-utils";
import { resetTestHistory, useTestSearchParams } from "@/lib/__tests__/next-navigation-double";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: vi.fn() }));

// Honours `allowedRoles` like the real guard, so "non-admin is blocked" is
// really a statement about what the page asked for.
vi.mock("@/components/ProtectedRoute", () => ({
  default: ({ children, allowedRoles }: { children: React.ReactNode; allowedRoles: string[] }) => {
    const { session } = useAuth();
    return allowedRoles.includes(session?.user?.role ?? "") ? <>{children}</> : <p>Acceso denegado</p>;
  },
}));

vi.mock("@/components/shell/AppShell", () => ({
  default: ({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) => (
    <div>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      {children}
    </div>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/actividad",
  useSearchParams: () => useTestSearchParams(),
  useRouter: () => ({
    replace: (url: string) => window.history.replaceState(null, "", url),
    push: (url: string) => window.history.pushState(null, "", url),
  }),
}));

const mockUseAuth = vi.mocked(useAuth);

function tileValue(label: string): string {
  const tile = screen.getAllByTestId("kpi-tile").find((t) => within(t).queryByText(label));
  if (!tile) throw new Error(`no tile ${label}`);
  return tile.querySelector(".font-display")?.textContent ?? "";
}

beforeEach(() => {
  resetTestHistory("/admin/actividad");
  mockUseAuth.mockReturnValue(createAuthenticatedAuth("admin"));
});

describe("ActividadPage — access", () => {
  it("shows nothing of the screen to a non-admin", () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("estudiante"));
    render(<ActividadPage />);
    expect(screen.getByText("Acceso denegado")).toBeInTheDocument();
    expect(screen.queryByText("Personas que ingresaron")).toBeNull();
  });

  it("titles itself and says the figures are a demonstration", () => {
    render(<ActividadPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Actividad del club" })).toBeInTheDocument();
    expect(screen.getByText("Datos de demostración")).toBeInTheDocument();
  });
});

describe("ActividadPage — Resumen", () => {
  it("opens on Resumen with the four club figures", () => {
    render(<ActividadPage />);
    expect(screen.getByRole("button", { name: "Resumen" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Métricas avanzadas" })).toHaveAttribute("aria-pressed", "false");
    for (const label of ["Personas que ingresaron", "Asistencias registradas", "Pagos registrados", "Inscripciones nuevas"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText(/alumnos/i, { selector: "[data-testid=kpi-tile] span" })).toBeInTheDocument();
    expect(screen.queryByText("Servicio")).toBeNull();
  });

  it("switches the figures when another range is chosen", () => {
    render(<ActividadPage />);
    expect(screen.getByRole("button", { name: /^7 días/ })).toHaveAttribute("aria-pressed", "true");
    const sevenDays = tileValue("Personas que ingresaron");
    fireEvent.click(screen.getByRole("button", { name: /^24 h/ }));
    expect(screen.getByRole("button", { name: /^24 h/ })).toHaveAttribute("aria-pressed", "true");
    expect(tileValue("Personas que ingresaron")).not.toBe(sevenDays);
    fireEvent.click(screen.getByRole("button", { name: /^30 días/ }));
    expect(tileValue("Personas que ingresaron")).not.toBe(sevenDays);
  });

  it("explains the status of the system in plain sentences, with an action when one is not fine", () => {
    render(<ActividadPage />);
    const card = screen.getByTestId("system-status");
    expect(within(card).getByText("La aplicación responde con normalidad.")).toBeInTheDocument();
    expect(within(card).getByText("No hay errores que afecten al club.")).toBeInTheDocument();
    expect(within(card).getByText(/Hay correos o avisos/)).toBeInTheDocument();
    expect(within(card).getByText(/técnico/)).toBeInTheDocument();
    expect(within(card).getAllByRole("listitem")).toHaveLength(3);
  });

  it("points the reader to the advanced metrics in the side panel", () => {
    render(<ActividadPage />);
    expect(screen.getByRole("complementary", { name: "Qué muestra esta pantalla" })).toHaveTextContent(/Métricas avanzadas/);
  });
});

describe("ActividadPage — Métricas avanzadas", () => {
  it("reflects the view in the address so it can be linked", () => {
    render(<ActividadPage />);
    fireEvent.click(screen.getByRole("button", { name: "Métricas avanzadas" }));
    expect(window.location.search).toBe("?vista=avanzadas");
    expect(screen.getByRole("button", { name: "Métricas avanzadas" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Resumen" }));
    expect(window.location.search).toBe("");
  });

  it("opens straight on the advanced view from a linked address", () => {
    window.history.replaceState(null, "", "/admin/actividad?vista=avanzadas");
    render(<ActividadPage />);
    expect(screen.getByRole("button", { name: "Métricas avanzadas" })).toHaveAttribute("aria-pressed", "true");
  });

  it("offers the advanced ranges and not the summary ones", () => {
    window.history.replaceState(null, "", "/admin/actividad?vista=avanzadas");
    render(<ActividadPage />);
    expect(screen.getByRole("button", { name: /^1 h/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^24 h/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^30 días/ })).toBeNull();
  });

  it("shows service (RED), server (USE) and users blocks, each with its own freshness", () => {
    window.history.replaceState(null, "", "/admin/actividad?vista=avanzadas");
    render(<ActividadPage />);
    for (const name of ["Servicio", "Servidor", "Memoria por contenedor", "Usuarios", "Base de datos, caché y colas"]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument();
    }
    expect(screen.getAllByText(/^Actualizado hace \d+ min$/).length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByTestId("sparkline").length).toBeGreaterThanOrEqual(5);
    expect(within(screen.getByTestId("service-metrics")).getAllByText("p50").length).toBeGreaterThan(0);
    expect(within(screen.getByTestId("service-metrics")).getAllByText("p95").length).toBeGreaterThan(0);
    expect(within(screen.getByTestId("service-metrics")).getAllByText("p99").length).toBeGreaterThan(0);
  });

  it("lists the slowest endpoints by route template and flags the slow one", () => {
    window.history.replaceState(null, "", "/admin/actividad?vista=avanzadas");
    render(<ActividadPage />);
    const table = screen.getByRole("table", { name: "Endpoints más lentos" });
    const rows = within(table).getAllByRole("row");
    expect(rows.length).toBeGreaterThan(3);
    expect(within(table).getByText("/api/v1/personas/{persona_id}")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Lento")).toBeInTheDocument();
  });

  it("makes the demo warning visible: swap is rising", () => {
    window.history.replaceState(null, "", "/admin/actividad?vista=avanzadas");
    render(<ActividadPage />);
    const swap = screen.getByTestId("metric-swap");
    expect(within(swap).getByText("En aumento")).toBeInTheDocument();
  });

  it("measures each container against its memory limit", () => {
    window.history.replaceState(null, "", "/admin/actividad?vista=avanzadas");
    render(<ActividadPage />);
    const meter = screen.getByRole("meter", { name: /celery-beat/ });
    expect(meter).toHaveAttribute("aria-valuemax", "224");
    expect(within(screen.getByTestId("container-memory")).getAllByRole("meter")).toHaveLength(8);
  });

  it("never prints identifying details", () => {
    window.history.replaceState(null, "", "/admin/actividad?vista=avanzadas");
    const { container } = render(<ActividadPage />);
    expect(container.textContent).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|@|postgres:\d|v\d+\.\d+\.\d+/);
  });
});
