/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import SessionHistoryList from "@/components/attendance/SessionHistoryList";
import AttendancePeriodRail from "@/components/attendance/AttendancePeriodRail";
import type { SessionSummary } from "@/app/trainer/trainer-day-utils";

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

function session(day: number, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    fecha: `2026-06-${String(day).padStart(2, "0")}`,
    horario: "Lunes 15:00 — 16:00",
    horarioId: 1,
    counts: { present: 3, absent: 1, late: 0, sick: 0, competition: 0 },
    total: 4,
    registradoPorNombre: "Carlos Mendoza",
    ...overrides,
  };
}

const EMPTY_ACTION = <a href="/x">Pasar lista</a>;

describe("SessionHistoryList", () => {
  it("renders one row per session with taker, result bar and ghost rows up to a page", async () => {
    render(<SessionHistoryList pageSize={10} sessions={[session(2), session(1)]} rangeInvalid={false} emptyAction={EMPTY_ACTION} />);

    const rows = (await screen.findAllByRole("row")).slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("02/06/2026");
    expect(rows[0]).toHaveTextContent("Carlos Mendoza");
    expect(screen.getAllByRole("img", { name: /3 presentes/i }).length).toBeGreaterThan(0);
    expect(screen.getByTestId("history-ghost-rows").querySelectorAll("li")).toHaveLength(8);
    expect(screen.queryByRole("columnheader", { name: "Acciones" })).not.toBeInTheDocument();
  });

  it("keeps the result bar short and fixed on desktop with the counts beside it", () => {
    render(<SessionHistoryList pageSize={10} sessions={[session(1, { reviewCount: 2 })]} rangeInvalid={false} emptyAction={EMPTY_ACTION} />);

    const bar = screen.getAllByRole("img", { name: /3 presentes/i })[0];
    expect(bar).toHaveClass("lg:w-40", "lg:flex-none");
    expect(bar).not.toHaveClass("lg:w-full");
    // Bar and counts share one line from `lg`, and the row never stretches with the window.
    const line = bar.parentElement as HTMLElement;
    expect(line).toHaveClass("lg:flex-row", "lg:items-center");
    expect(line).toHaveTextContent("3 presentes");
    const group = line.parentElement as HTMLElement;
    expect(group.className).not.toMatch(/min-w-\[240px\]/);
    expect(group).toHaveTextContent("2 por revisar");
  });

  // ENT-19 / ADMA-29: «No registrado» read as «the attendance was not recorded».
  it("shows a dash, never «No registrado», when a session has no author", async () => {
    render(
      <SessionHistoryList
        pageSize={10}
        sessions={[session(1, { registradoPorNombre: null })]}
        rangeInvalid={false}
        emptyAction={EMPTY_ACTION}
      />,
    );

    const rows = (await screen.findAllByRole("row")).slice(1);
    expect(rows[0]).toHaveTextContent("—");
    expect(screen.queryByText(/No registrado/)).not.toBeInTheDocument();
  });

  // ENT-07: a session holding records flagged for review says so in the list, so
  // the admin does not have to open every session to find them.
  it("flags the sessions that hold records to review, and only those", async () => {
    render(
      <SessionHistoryList
        pageSize={10}
        sessions={[session(2, { reviewCount: 2 }), session(1, { reviewCount: 0 })]}
        rangeInvalid={false}
        emptyAction={EMPTY_ACTION}
      />,
    );

    const rows = (await screen.findAllByRole("row")).slice(1);
    expect(rows[0]).toHaveTextContent("2 por revisar");
    expect(rows[1]).not.toHaveTextContent("por revisar");
  });

  it("says why the list is empty, differently for an unusable range", () => {
    const { rerender } = render(
      <SessionHistoryList pageSize={10} sessions={[]} rangeInvalid={false} emptyAction={EMPTY_ACTION} />,
    );
    expect(screen.getByText(/pasa lista para que aparezca/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pasar lista" })).toBeInTheDocument();

    rerender(<SessionHistoryList pageSize={10} sessions={[]} rangeInvalid emptyAction={EMPTY_ACTION} />);
    expect(screen.getByText("Ajuste el rango de fechas para ver las listas.")).toBeInTheDocument();
  });

  it("hides the duplicate empty-state CTA and caps ghost rows on phones", () => {
    render(<SessionHistoryList pageSize={10} sessions={[]} rangeInvalid={false} emptyAction={EMPTY_ACTION} />);
    expect(screen.getByRole("link", { name: "Pasar lista" }).parentElement).toHaveClass("max-lg:hidden");
    expect(screen.getByTestId("history-ghost-rows")).toHaveClass("max-lg:[&>li:nth-child(n+3)]:hidden");
  });

  it("paginates by session and returns to page 1 when the result set changes", () => {
    const many = Array.from({ length: 12 }, (_, i) => session(i + 1));
    const { rerender } = render(
      <SessionHistoryList pageSize={10} sessions={many} rangeInvalid={false} emptyAction={EMPTY_ACTION} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));
    expect(screen.getByText("Página 2 de 2")).toBeInTheDocument();

    rerender(<SessionHistoryList pageSize={10} sessions={many.slice(0, 11)} rangeInvalid={false} emptyAction={EMPTY_ACTION} />);
    expect(screen.getByText("Página 1 de 2")).toBeInTheDocument();
  });

  it("expands one session at a time into the drill-down, rendered once", () => {
    const renderDetail = vi.fn((s: SessionSummary) => <p>Detalle {s.fecha}</p>);
    render(
      <SessionHistoryList
        pageSize={10}
        sessions={[session(2), session(1)]}
        rangeInvalid={false}
        emptyAction={EMPTY_ACTION}
        renderDetail={renderDetail}
      />,
    );
    expect(screen.queryByTestId("session-detail")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /^Registros/ })[0]);
    expect(screen.getAllByTestId("session-detail")).toHaveLength(1);
    expect(screen.getByText("Detalle 2026-06-02")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /^Registros/ })[1]);
    expect(screen.queryByText("Detalle 2026-06-02")).not.toBeInTheDocument();
    expect(screen.getByText("Detalle 2026-06-01")).toBeInTheDocument();
  });

  describe("detail placement", () => {
    const original = window.matchMedia;
    afterEach(() => {
      window.matchMedia = original;
    });
    const setViewport = (desktop: boolean): void => {
      window.matchMedia = ((query: string) => ({
        matches: desktop,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      })) as unknown as typeof window.matchMedia;
    };
    const renderThree = (): void => {
      render(
        <SessionHistoryList
          pageSize={10}
          sessions={[session(3), session(2), session(1)]}
          rangeInvalid={false}
          emptyAction={EMPTY_ACTION}
          renderDetail={(s) => <button type="button" id={`fix-${s.fecha}`}>Corregir {s.fecha}</button>}
        />,
      );
    };

    it("opens the detail in the row right under the selected session on desktop", () => {
      setViewport(true);
      renderThree();
      const table = screen.getByTestId("history-desktop-table");
      const toggle = within(table).getAllByRole("button", { name: /^Registros/ })[1];
      fireEvent.click(toggle);

      const panel = screen.getByTestId("session-detail");
      const selectedRow = toggle.closest("tr") as HTMLElement;
      expect(selectedRow.nextElementSibling).toBe(panel.closest("tr"));
      expect(selectedRow).toHaveTextContent("02/06/2026");
      expect(panel.closest("td")).toHaveAttribute("colspan");
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(toggle).toHaveAttribute("aria-controls", panel.id);
    });

    it("opens the detail inside the selected card on mobile", () => {
      setViewport(false);
      renderThree();
      const list = screen.getByTestId("history-mobile-list");
      const toggle = within(list).getAllByRole("button", { name: /^Registros/ })[1];
      fireEvent.click(toggle);

      const panel = screen.getByTestId("session-detail");
      expect(screen.getByTestId("history-mobile-card-2026-06-02-1")).toContainElement(panel);
      expect(toggle).toHaveAttribute("aria-controls", panel.id);
    });

    it("keeps a single panel, with no duplicated ids, and closes the previous one", () => {
      setViewport(true);
      renderThree();
      fireEvent.click(screen.getAllByRole("button", { name: /^Registros/ })[0]);
      fireEvent.click(screen.getAllByRole("button", { name: /^Registros/ })[2]);

      expect(screen.getAllByTestId("session-detail")).toHaveLength(1);
      expect(screen.getAllByRole("button", { name: /^Corregir/ })).toHaveLength(1);
      const ids = Array.from(document.querySelectorAll("[id]")).map((el) => el.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(screen.getByTestId("session-detail").closest("tr")?.previousElementSibling).toHaveTextContent("01/06/2026");
    });

    it("closes the open detail when the page changes", () => {
      setViewport(true);
      const many = Array.from({ length: 11 }, (_, i) => session(i + 1));
      render(
        <SessionHistoryList
          pageSize={10}
          sessions={many}
          rangeInvalid={false}
          emptyAction={EMPTY_ACTION}
          renderDetail={() => <p>Detalle</p>}
        />,
      );
      fireEvent.click(screen.getAllByRole("button", { name: /^Registros/ })[0]);
      expect(screen.getByTestId("session-detail")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));
      expect(screen.queryByTestId("session-detail")).not.toBeInTheDocument();
    });
  });

  it("adds the actions column only when a role-specific action is given", () => {
    render(
      <SessionHistoryList
        pageSize={10}
        sessions={[session(1)]}
        rangeInvalid={false}
        emptyAction={EMPTY_ACTION}
        renderAction={() => <button type="button">Corregir</button>}
      />,
    );
    expect(screen.getByRole("columnheader", { name: "Acciones" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Corregir" }).length).toBeGreaterThan(0);
  });
});

describe("AttendancePeriodRail", () => {
  const baseProps = {
    sessions: [session(1)],
    schedules: [],
    fechaInicio: "2026-06-01",
    fechaFin: "2026-06-30",
    horarioId: null,
  };

  it("draws stats, distribution, sessions without list and the standing guide", () => {
    render(<AttendancePeriodRail {...baseProps} studentFiltered={false} guideExtra={<p>Regla extra</p>} />);

    const rail = screen.getByRole("complementary", { name: "Resumen del período" });
    expect(rail).toHaveTextContent("Listas tomadas");
    expect(within(rail).getByRole("heading", { name: "Distribución del período" })).toBeInTheDocument();
    expect(rail).toHaveTextContent("3 presentes");
    expect(within(rail).getByRole("region", { name: "Sin lista en el período" })).toBeInTheDocument();
    expect(within(rail).getByRole("heading", { name: "Cómo leer el historial" })).toBeInTheDocument();
    expect(rail).toHaveTextContent("Regla extra");
  });

  it("replaces the schedule comparison with its explanation when a student is filtered", () => {
    render(<AttendancePeriodRail {...baseProps} studentFiltered />);

    expect(screen.queryByText("Listas tomadas")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Distribución del período" })).not.toBeInTheDocument();
    expect(screen.getByText(/no se compara contra el horario semanal al filtrar por alumno/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Cómo leer el historial" })).toBeInTheDocument();
  });

  // ENT-13 / ENT-20 / ADMA-21
  it("lists a partly-filled list as «N de M registrados» with «Completar lista»", () => {
    render(
      <AttendancePeriodRail
        {...baseProps}
        sessions={[session(1, { total: 5 })]}
        schedules={[{ id: 1, diaSemana: "lun", horaInicio: "15:00", horaFin: "16:00" }]}
        fechaFin="2026-06-01"
        inscritosPorHorario={{ 1: 62 }}
        studentFiltered={false}
      />,
    );

    const missing = screen.getByRole("region", { name: "Sin lista en el período" });
    expect(missing).toHaveTextContent("5 de 62 registrados");
    expect(within(missing).getByRole("link", { name: /Completar lista del/ })).toHaveTextContent("Completar lista");
    expect(screen.queryByText("Todas las sesiones del período tienen lista.")).not.toBeInTheDocument();
  });

  it("paints the «Estimación» note in the AA-contrast ink", () => {
    render(<AttendancePeriodRail {...baseProps} studentFiltered={false} />);

    expect(screen.getByRole("note")).toHaveClass("text-ink-3-strong");
  });
});
