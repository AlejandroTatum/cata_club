/**
 * Component tests for the trainer's attendance history
 * (`docs/ux/prototipos/21-entrenador-historial.html`).
 *
 * The route used to be a bare `redirect("/trainer")`. It is a real screen
 * again, and the thing worth pinning down is the grouping: one row per
 * SESSION, not one per student — "el entrenador no busca «qué hizo Ana el
 * 14»; busca «la lista del lunes pasado»".
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import TrainerAttendanceHistoryPage from "@/app/trainer/attendance/history/page";
import type { AttendanceRecord } from "@/app/attendance/attendance-utils";
import { createAuthenticatedAuth } from "@/components/__tests__/test-utils";

vi.mock("@/components/ProtectedRoute", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => createAuthenticatedAuth("trainer", "Carlos Mendoza"),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/trainer/attendance/history",
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/image", () => ({
  __esModule: true,
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ alt }: { alt: string }) => <img alt={alt} />,
}));

const mockFetchAttendanceRecords = vi.fn();

vi.mock("@/services/api", () => ({
  fetchAttendanceRecords: (params?: unknown) => mockFetchAttendanceRecords(params),
  fetchNotificaciones: vi.fn().mockResolvedValue([]),
  marcarNotificacionLeida: vi.fn().mockResolvedValue(undefined),
}));

function record(
  estado: AttendanceRecord["estado"],
  estudiante: string,
  fecha: string,
  horario = "Lunes 15:00 — 16:00",
  entrenador = "Carlos Mendoza",
): AttendanceRecord {
  return {
    id: `${estudiante}-${fecha}-${horario}-${estado}`,
    fecha,
    horario,
    personaId: 1,
    estudiante,
    estado,
    entrenador,
  };
}

const RECORDS: AttendanceRecord[] = [
  record("present", "Sofia Vera", "2026-07-20"),
  record("present", "Diego Mendoza", "2026-07-20"),
  record("late", "Ana Garcia", "2026-07-20"),
  record("absent", "Luis Lopez", "2026-07-20"),
  // A different session on an earlier day, filed by a substitute.
  record("present", "Kevin Sabando", "2026-07-17", "Viernes 17:00 — 18:00", "Ana Solórzano"),
  record("justified", "Melany Quimis", "2026-07-17", "Viernes 17:00 — 18:00", "Ana Solórzano"),
];

describe("TrainerAttendanceHistoryPage", () => {
  beforeEach(() => {
    mockFetchAttendanceRecords.mockReset().mockResolvedValue(RECORDS);
  });

  it("renders one row per session, most recent first — not one per student", async () => {
    render(<TrainerAttendanceHistoryPage />);

    const rows = await screen.findAllByRole("row");
    // 1 header + 2 sessions, from 6 student records.
    expect(rows).toHaveLength(3);
    expect(within(rows[1]).getByText("Lunes 15:00 — 16:00")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Viernes 17:00 — 18:00")).toBeInTheDocument();
    // No student name appears anywhere: this list is about sessions.
    expect(screen.queryByText("Sofia Vera")).not.toBeInTheDocument();
  });

  it("shows who actually filed each list, so substitutions stay visible", async () => {
    render(<TrainerAttendanceHistoryPage />);

    const rows = await screen.findAllByRole("row");
    expect(within(rows[1]).getByText("Carlos Mendoza")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Ana Solórzano")).toBeInTheDocument();
    expect(
      screen.getByText(/Quien registró puede diferir del entrenador titular/),
    ).toBeInTheDocument();
  });

  it("carries the four state counts in the row itself, named for a screen reader", async () => {
    render(<TrainerAttendanceHistoryPage />);

    const rows = await screen.findAllByRole("row");
    // The pill shows only the count; the state name rides along in an
    // `sr-only` span, so the accessible text is "2 presente" while the 26px
    // badge still reads "2".
    expect(rows[1]).toHaveTextContent("2 presente");
    expect(rows[1]).toHaveTextContent("1 tardanza");
    expect(rows[1]).toHaveTextContent("0 justificado");
    expect(rows[1]).toHaveTextContent("1 ausente");
  });

  it("offers a Corregir action per session", async () => {
    render(<TrainerAttendanceHistoryPage />);

    const links = await screen.findAllByRole("link", { name: "Corregir" });
    expect(links).toHaveLength(2);
    // Deep-linking to the session is blocked: `AttendanceRecord` has no
    // `horarioId`, so the wizard opens at its own first step.
    expect(links[0]).toHaveAttribute("href", "/trainer/attendance");
  });

  it("refetches with a new range when a preset is picked", async () => {
    render(<TrainerAttendanceHistoryPage />);
    await screen.findAllByRole("row");
    mockFetchAttendanceRecords.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Hoy" }));

    await waitFor(() => {
      expect(mockFetchAttendanceRecords).toHaveBeenCalledTimes(1);
    });
    const params = mockFetchAttendanceRecords.mock.calls[0][0] as {
      fechaInicio: string;
      fechaFin: string;
    };
    expect(params.fechaInicio).toBe(params.fechaFin);
  });

  it("shows an actionable empty state for a period with no lists", async () => {
    mockFetchAttendanceRecords.mockResolvedValue([]);
    render(<TrainerAttendanceHistoryPage />);

    expect(await screen.findByText("No hay listas en este período")).toBeInTheDocument();
    expect(
      within(screen.getByRole("main")).getByRole("link", { name: "Pasar lista" }),
    ).toHaveAttribute("href", "/trainer/attendance");
  });

  it("recovers from a failed load with a retry", async () => {
    mockFetchAttendanceRecords.mockRejectedValueOnce(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(<TrainerAttendanceHistoryPage />);

    expect(await screen.findByText(/No se pudieron cargar los registros/)).toBeInTheDocument();
    mockFetchAttendanceRecords.mockResolvedValue(RECORDS);
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    await waitFor(() => {
      expect(screen.getByText("Lunes 15:00 — 16:00")).toBeInTheDocument();
    });
  });

  it("leads back to Mi día", async () => {
    render(<TrainerAttendanceHistoryPage />);

    await screen.findAllByRole("row");
    expect(screen.getByRole("link", { name: /Volver a Mi día/ })).toHaveAttribute(
      "href",
      "/trainer",
    );
  });
});
