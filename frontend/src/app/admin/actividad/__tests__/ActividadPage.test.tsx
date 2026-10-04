/**
 * "Actividad del club" — admin-only, read-only, fed by the activity endpoints
 * (mocked here at the fetcher seam, with backend-shaped fixtures).
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import ActividadPage from "../page";
import { fetchActividadAvanzadas, fetchActividadResumen } from "@/services/api";
import type { AvanzadasData, ResumenData } from "../actividad-types";
import { FIXTURE_NOW, avanzadasFixture, resumenFixture } from "./fixtures";
import { useAuth } from "@/contexts/AuthContext";
import { createAuthenticatedAuth } from "@/components/__tests__/test-utils";
import { resetTestHistory, useTestSearchParams } from "@/lib/__tests__/next-navigation-double";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("@/services/api", () => ({ fetchActividadResumen: vi.fn(), fetchActividadAvanzadas: vi.fn() }));

// Honours `allowedRoles` like the real guard, so "non-admin is blocked" is
// really a statement about what the page asked for.
vi.mock("@/components/ProtectedRoute", () => {
  function ProtectedRoute({ children, allowedRoles }: { children: React.ReactNode; allowedRoles: string[] }): React.ReactElement {
    const { session } = useAuth();
    return allowedRoles.includes(session?.user?.role ?? "") ? <>{children}</> : <p>Acceso denegado</p>;
  }
  return { default: ProtectedRoute };
});

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
const mockResumen = vi.mocked(fetchActividadResumen);
const mockAvanzadas = vi.mocked(fetchActividadAvanzadas);

const ADVANCED_URL = "/admin/actividad?vista=avanzadas";
const POLL_MS = 60_000;

function tileValue(label: string): string {
  const tile = screen.getAllByTestId("kpi-tile").find((t) => within(t).queryByText(label));
  if (!tile) throw new Error(`no tile ${label}`);
  return tile.querySelector(".font-display")?.textContent ?? "";
}

async function renderResumen(): Promise<void> {
  render(<ActividadPage />);
  await screen.findByTestId("activity-kpis");
}

async function renderAvanzadas(data?: AvanzadasData): Promise<void> {
  if (data) mockAvanzadas.mockResolvedValue(data);
  window.history.replaceState(null, "", ADVANCED_URL);
  render(<ActividadPage />);
  await screen.findByTestId("advanced-work");
}

function setVisibility(state: "hidden" | "visible"): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  Object.defineProperty(document, "hidden", { configurable: true, get: () => state === "hidden" });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  // Only the clock and the interval are faked: `waitFor` and promises keep running.
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date(FIXTURE_NOW));
  resetTestHistory("/admin/actividad");
  mockUseAuth.mockReturnValue(createAuthenticatedAuth("admin"));
  mockResumen.mockImplementation(async (range) => resumenFixture(range));
  mockAvanzadas.mockImplementation(async (range) => avanzadasFixture(range));
});

afterEach(() => {
  setVisibility("visible");
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("ActividadPage — access and honesty", () => {
  it("shows nothing of the screen to a non-admin, and asks the backend for nothing", () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("estudiante"));
    render(<ActividadPage />);
    expect(screen.getByText("Acceso denegado")).toBeInTheDocument();
    expect(screen.queryByText("Personas que ingresaron")).toBeNull();
    expect(mockResumen).not.toHaveBeenCalled();
  });

  it("titles itself and carries no demonstration wording", async () => {
    await renderResumen();
    expect(screen.getByRole("heading", { level: 1, name: "Actividad del club" })).toBeInTheDocument();
    expect(screen.queryByText(/demostración/i)).toBeNull();
    expect(screen.queryByText("Origen de las cifras")).toBeNull();
  });
});

describe("ActividadPage — Resumen", () => {
  it("shows a loading state, then the four club figures from the endpoint", async () => {
    render(<ActividadPage />);
    expect(screen.getByText("Cargando actividad…")).toBeInTheDocument();
    await screen.findByTestId("activity-kpis");
    expect(mockResumen).toHaveBeenCalledTimes(1);
    expect(mockResumen).toHaveBeenCalledWith("7d");
    // Only the one-off health probe for «Estado del sistema» (ADMB-01), never the full view.
    expect(mockAvanzadas.mock.calls).toEqual([["1h"]]);
    expect(screen.getByRole("button", { name: "Resumen" })).toHaveAttribute("aria-pressed", "true");
    for (const label of ["Personas que ingresaron", "Asistencias registradas", "Pagos registrados", "Inscripciones nuevas"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(tileValue("Personas que ingresaron")).toBe("222");
    expect(screen.queryByText("Servicio")).toBeNull();
  });

  it("fetches again, once, when another range is chosen", async () => {
    await renderResumen();
    fireEvent.click(screen.getByRole("button", { name: /^24 h/ }));
    await waitFor(() => expect(mockResumen).toHaveBeenLastCalledWith("24h"));
    await waitFor(() => expect(tileValue("Personas que ingresaron")).toBe("129"));
    fireEvent.click(screen.getByRole("button", { name: /^30 días/ }));
    await waitFor(() => expect(tileValue("Personas que ingresaron")).toBe("291"));
    expect(mockResumen).toHaveBeenCalledTimes(3);
  });

  it("does not poll: the summary only reloads when the range changes", async () => {
    await renderResumen();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    });
    expect(mockResumen).toHaveBeenCalledTimes(1);
  });

  it("explains the status in plain sentences, with an action when one is not fine", async () => {
    await renderResumen();
    const card = screen.getByTestId("system-status");
    expect(within(card).getByText("La aplicación responde con normalidad.")).toBeInTheDocument();
    expect(within(card).getByText("No hay errores que afecten al club.")).toBeInTheDocument();
    expect(within(card).getByText(/Hay correos o avisos/)).toBeInTheDocument();
    expect(within(card).getByText(/técnico/)).toBeInTheDocument();
    expect(within(card).getAllByRole("listitem")).toHaveLength(3);
  });

  it("switches the system status to «Atención» when the advanced metrics cannot be read (ADMB-01)", async () => {
    mockAvanzadas.mockRejectedValue(new Error("boom"));
    await renderResumen();
    const card = screen.getByTestId("system-status");
    await waitFor(() => expect(within(card).getByText(/No se pudieron leer las métricas/)).toBeInTheDocument());
    expect(within(card).getAllByText("Atención").length).toBeGreaterThan(0);
  });

  it("names the degraded component under «Atención» when the heartbeat reports it (ADMB-N1)", async () => {
    mockResumen.mockResolvedValue({
      ...resumenFixture("7d"),
      health: {
        state: "degraded",
        degraded: true,
        heartbeatAgeSeconds: 400,
        components: [
          { key: "workers", reason: "heartbeat_stale" },
          { key: "email", reason: "heartbeat_stale" },
        ],
      },
    });
    await renderResumen();
    const card = screen.getByTestId("system-status");
    const row = within(card).getByTestId("system-health");
    expect(row).toHaveTextContent(/procesos en segundo plano/i);
    expect(row).toHaveTextContent(/envío de correos/i);
    expect(within(row).getByText("Atención")).toBeInTheDocument();
  });

  it("shows no health row when the heartbeat reports ok or the field is missing (ADMB-N1)", async () => {
    mockResumen.mockResolvedValue({
      ...resumenFixture("7d"),
      health: { state: "ok", degraded: false, heartbeatAgeSeconds: 12, components: [] },
    });
    await renderResumen();
    expect(within(screen.getByTestId("system-status")).queryByTestId("system-health")).toBeNull();
  });

  it("tolerates a null or absent health field (ADMB-N1)", async () => {
    mockResumen.mockResolvedValue({ ...resumenFixture("7d"), health: null });
    await renderResumen();
    const card = screen.getByTestId("system-status");
    expect(within(card).queryByTestId("system-health")).toBeNull();
    expect(within(card).getAllByRole("listitem")).toHaveLength(3);
  });

  it("does not mention the daily email limit when nothing is waiting for it", async () => {
    await renderResumen();
    expect(screen.queryByTestId("queued-by-quota")).toBeNull();
  });

  it("tells the admin how many emails wait for the daily limit", async () => {
    mockResumen.mockResolvedValue({ ...resumenFixture("7d"), queuedByQuota: 3 });
    await renderResumen();
    expect(screen.getByTestId("queued-by-quota")).toHaveTextContent(
      "3 correos esperan el reinicio del límite diario y se enviarán mañana.",
    );
  });

  it("says how fresh the figures are instead of calling them a demo", async () => {
    await renderResumen();
    expect(within(screen.getByTestId("system-status")).getByText("Actualizado ahora")).toBeInTheDocument();
  });

  it("reads an unmeasured status as 'Sin datos todavía', neutral, without alarm wording", async () => {
    const data: ResumenData = {
      ...resumenFixture("7d"),
      status: [
        { key: "app", level: "unknown" },
        { key: "errors", level: "unknown" },
        { key: "notifications", level: "ok" },
      ],
    };
    mockResumen.mockResolvedValue(data);
    await renderResumen();
    const card = screen.getByTestId("system-status");
    expect(within(card).getAllByText(/Sin datos todavía/)).toHaveLength(2);
    expect(within(card).queryByText("Atención")).toBeNull();
    expect(within(card).queryByText("Urgente")).toBeNull();
    expect(card.querySelector(".bg-state-neutral")).not.toBeNull();
  });

  it("says there is no movement yet when nobody signed in", async () => {
    const quiet = resumenFixture("7d");
    mockResumen.mockResolvedValue({
      ...quiet,
      periods: quiet.periods.map((p) => ({ ...p, visitors: { alumnos: 0, entrenadores: 0, representantes: 0 } })),
    });
    await renderResumen();
    expect(screen.getByText("Todavía no hay movimiento")).toBeInTheDocument();
  });

  it("does not footnote people with several roles (one role per user is enforced)", async () => {
    await renderResumen();
    expect(screen.queryByText(/varios roles/i)).toBeNull();
  });

  it("points the reader to the advanced metrics in the side panel", async () => {
    await renderResumen();
    expect(screen.getByRole("complementary", { name: "Qué muestra esta pantalla" })).toHaveTextContent(/Métricas avanzadas/);
  });

  it("words the payments caption and the side panel without receipts or jargon (ADMB-32)", async () => {
    await renderResumen();
    expect(screen.getByText(/^Registrados en /)).toBeInTheDocument();
    expect(screen.queryByText(/Comprobantes recibidos/)).toBeNull();
    const panel = screen.getByRole("complementary", { name: "Qué muestra esta pantalla" });
    expect(panel).toHaveTextContent(/Cambie el período/);
    expect(panel).not.toHaveTextContent(/del servidor/);
  });

  it("turns a 403 into a notice that names the permission and offers a retry", async () => {
    mockResumen.mockRejectedValueOnce(Object.assign(new Error("forbidden"), { status: 403 }));
    render(<ActividadPage />);
    const notice = await screen.findByTestId("section-notice");
    expect(notice).toHaveTextContent(/permiso/i);
    expect(screen.queryByTestId("activity-kpis")).toBeNull();

    fireEvent.click(within(notice).getByRole("button", { name: "Reintentar" }));
    await screen.findByTestId("activity-kpis");
    expect(mockResumen).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("section-notice")).toBeNull();
  });

  it("turns any other failure into a retryable notice, never into an empty chart", async () => {
    mockResumen.mockRejectedValueOnce(new Error("boom"));
    render(<ActividadPage />);
    const notice = await screen.findByTestId("section-notice");
    expect(notice).toHaveTextContent(/No se pudo cargar/);
    expect(screen.queryByText("Todavía no hay movimiento")).toBeNull();
  });
});

describe("ActividadPage — Métricas avanzadas", () => {
  it("reflects the view in the address so it can be linked", async () => {
    await renderResumen();
    fireEvent.click(screen.getByRole("button", { name: "Métricas avanzadas" }));
    expect(window.location.search).toBe("?vista=avanzadas");
    await screen.findByTestId("advanced-work");
    fireEvent.click(screen.getByRole("button", { name: "Resumen" }));
    expect(window.location.search).toBe("");
  });

  it("opens straight on the advanced view and asks for the default range", async () => {
    await renderAvanzadas();
    expect(screen.getByRole("button", { name: "Métricas avanzadas" })).toHaveAttribute("aria-pressed", "true");
    expect(mockAvanzadas).toHaveBeenCalledWith("1h");
    expect(mockResumen).not.toHaveBeenCalled();
  });

  it("offers the advanced ranges and not the summary ones, and refetches on change", async () => {
    await renderAvanzadas();
    expect(screen.getByRole("button", { name: /^1 h/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: /^30 días/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^7 días/ }));
    await waitFor(() => expect(mockAvanzadas).toHaveBeenLastCalledWith("7d"));
  });

  it("shows service (RED), server (USE) and users blocks, each with its own freshness", async () => {
    await renderAvanzadas();
    for (const name of ["Servicio", "Servidor", "Memoria por contenedor", "Usuarios", "Base de datos, caché y colas"]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument();
    }
    expect(screen.getAllByText(/^Actualizado (hace \d+ min|ahora)$/).length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByTestId("sparkline").length).toBeGreaterThanOrEqual(5);
    const service = within(screen.getByTestId("service-metrics"));
    for (const p of ["p50", "p95", "p99"]) expect(service.getAllByText(p).length).toBeGreaterThan(0);
  });

  it("names the error rates in plain Spanish, without 5xx or 4xx (TXT-12)", async () => {
    await renderAvanzadas();
    expect(screen.queryByText(/[45]xx/)).toBeNull();
    expect(screen.getByText("Errores del servidor")).toBeInTheDocument();
    expect(screen.getByText("Solicitudes rechazadas")).toBeInTheDocument();
  });

  it("lists the slowest endpoints by route template, flags the slow one, and accepts any HTTP verb", async () => {
    const data = avanzadasFixture("1h");
    mockAvanzadas.mockResolvedValue({
      ...data,
      service: {
        ...data.service!,
        slowEndpoints: [{ method: "DELETE", route: "/api/v1/galeria/{id}", p95Ms: 1500, requests: 3 }],
      },
    });
    await renderAvanzadas();
    const table = screen.getByRole("table", { name: "Endpoints más lentos" });
    expect(within(table).getByText("DELETE")).toBeInTheDocument();
    expect(within(table).getByText("/api/v1/galeria/{id}")).toBeInTheDocument();
    expect(within(table).getByText("Lento")).toBeInTheDocument();
  });

  it("makes the swap warning visible when swap is rising", async () => {
    await renderAvanzadas();
    expect(within(screen.getByTestId("metric-swap")).getByText("En aumento")).toBeInTheDocument();
  });

  it("measures each container against its memory limit", async () => {
    await renderAvanzadas();
    expect(screen.getByRole("meter", { name: /celery-beat/ })).toHaveAttribute("aria-valuemax", "224");
    expect(within(screen.getByTestId("container-memory")).getAllByRole("meter")).toHaveLength(8);
  });

  it("never prints identifying details", async () => {
    window.history.replaceState(null, "", ADVANCED_URL);
    await renderAvanzadas();
    expect(document.body.textContent).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|@|postgres:\d|v\d+\.\d+\.\d+/);
  });

  it("gives a block that has no measurements its own notice instead of crashing", async () => {
    await renderAvanzadas({ range: "1h", service: null, host: null, runtime: null, users: null });
    for (const testId of ["service-metrics", "server-metrics", "container-memory", "backstage-metrics", "users-metrics"]) {
      expect(within(screen.getByTestId(testId)).getByText(/Aún no hay mediciones/)).toBeInTheDocument();
    }
    expect(screen.queryByTestId("sparkline")).toBeNull();
  });

  it("shows '—' for latencies, cache limit, queue and connection figures that were not measured", async () => {
    const data = avanzadasFixture("1h");
    await renderAvanzadas({
      ...data,
      service: { ...data.service!, latencyMs: { p50: null, p95: null, p99: null }, slowEndpoints: [] },
      runtime: {
        ...data.runtime!,
        database: { connectionsUsed: null, connectionsMax: null },
        redis: { usedMb: 22, maxMb: null },
        queues: { celeryPending: null, notificationsPending: null, oldestNotificationMinutes: null },
      },
      users: { ...data.users!, connectedNow: null, sessionsByRole: null },
    });
    const latency = within(screen.getByTestId("service-metrics"));
    expect(latency.getAllByText("—")).toHaveLength(3);
    expect(latency.queryByText("Lento")).toBeNull();
    const backstage = within(screen.getByTestId("backstage-metrics"));
    expect(backstage.getAllByText("—").length).toBeGreaterThanOrEqual(4);
    expect(backstage.queryByRole("meter", { name: /caché/ })).toBeNull();
    expect(within(screen.getByTestId("users-metrics")).getByText(/Aún no hay mediciones de sesiones/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/NaN|undefined/);
  });

  it("leaves gaps for missing readings and does not turn them into zero", async () => {
    const data = avanzadasFixture("1h");
    const gap = { stepMinutes: 1, values: [30, 32, null, null, 31, 33] };
    await renderAvanzadas({ ...data, host: { ...data.host!, cpuPercent: gap } });
    const cpu = within(screen.getByTestId("metric-cpu"));
    expect(cpu.getAllByTestId("sparkline-line")).toHaveLength(2);
    expect(cpu.getByRole("img").getAttribute("aria-label")).toMatch(/mínimo 30 %, máximo 33 %/);
  });

  it("shows the age of the host snapshot and warns when it is older than 3 minutes", async () => {
    const data = avanzadasFixture("1h");
    await renderAvanzadas({ ...data, host: { ...data.host!, updatedAt: "2026-10-01T15:20:00-05:00" } });
    const server = within(screen.getByTestId("server-metrics"));
    expect(server.getByText("Actualizado hace 10 min")).toBeInTheDocument();
    expect(server.getByText("Datos desactualizados")).toBeInTheDocument();
  });

  it("does not warn about a fresh host snapshot", async () => {
    await renderAvanzadas();
    expect(within(screen.getByTestId("server-metrics")).queryByText("Datos desactualizados")).toBeNull();
  });

  it("turns a 403 into a permission notice with a retry", async () => {
    mockAvanzadas.mockRejectedValueOnce(Object.assign(new Error("forbidden"), { status: 403 }));
    window.history.replaceState(null, "", ADVANCED_URL);
    render(<ActividadPage />);
    const notice = await screen.findByTestId("section-notice");
    expect(notice).toHaveTextContent(/permiso/i);
    fireEvent.click(within(notice).getByRole("button", { name: "Reintentar" }));
    await screen.findByTestId("advanced-work");
  });
});

describe("ActividadPage — Métricas avanzadas polling", () => {
  it("refreshes every 60 seconds while the tab is visible", async () => {
    await renderAvanzadas();
    expect(mockAvanzadas).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS - 1);
    });
    expect(mockAvanzadas).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mockAvanzadas).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });
    expect(mockAvanzadas).toHaveBeenCalledTimes(3);
  });

  it("pauses while the tab is hidden and catches up as soon as it is visible again", async () => {
    await renderAvanzadas();
    setVisibility("hidden");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    });
    expect(mockAvanzadas).toHaveBeenCalledTimes(1);

    await act(async () => {
      setVisibility("visible");
    });
    expect(mockAvanzadas).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });
    expect(mockAvanzadas).toHaveBeenCalledTimes(3);
  });

  it("keeps the last good figures when a refresh fails", async () => {
    await renderAvanzadas();
    mockAvanzadas.mockRejectedValueOnce(new Error("blip"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });
    expect(mockAvanzadas).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("advanced-work")).toBeInTheDocument();
    expect(screen.queryByTestId("section-notice")).toBeNull();
  });

  it("stops polling when the reader leaves the advanced view", async () => {
    await renderAvanzadas();
    fireEvent.click(screen.getByRole("button", { name: "Resumen" }));
    await screen.findByTestId("activity-kpis");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    });
    // 1 from the advanced view + 1 health probe from the summary; no polling after leaving.
    expect(mockAvanzadas).toHaveBeenCalledTimes(2);
  });
});

describe("ActividadPage — Resumen layout", () => {
  it("stretches the usage card to the rail height from lg up, and only from lg up", async () => {
    await renderResumen();
    const work = screen.getByTestId("activity-work");
    expect(work.className).toContain("lg:items-stretch");
    const column = work.children[0] as HTMLElement;
    expect(column.className).toContain("[&>section]:flex-1");
    const card = screen.getByTestId("usage-chart");
    const chart = within(card).getByTestId("stacked-bars");
    expect(chart.className).toContain("lg:flex-1");
    const plot = within(card).getAllByTestId("stacked-column")[0].parentElement!.parentElement!;
    expect(plot.className).toContain("h-44");
    expect(plot.className).toContain("lg:h-auto");
    expect(plot.className).toContain("lg:flex-1");
  });
});
