/**
 * The small dashboard charts: each draws from its data, names itself in one
 * sentence for assistive tech, and opens its tooltip on keyboard focus as well
 * as on hover.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { Bars, Dots, Ring, SegmentBar, StackedBars, Timeline } from "@/components/charts";

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe("Ring", () => {
  it("names the part over the whole and its percentage", () => {
    render(<Ring value={17} total={40} label="Membresías activas" />);
    expect(screen.getByRole("img", { name: "Membresías activas: 17 de 40 (43%)" })).toBeInTheDocument();
    expect(screen.getByTestId("ring-arc")).toBeInTheDocument();
  });

  it("draws no arc for an empty whole instead of dividing by zero", () => {
    render(<Ring value={0} total={0} label="Membresías activas" />);
    expect(screen.getByRole("img", { name: /0 de 0 \(0%\)/ })).toBeInTheDocument();
    expect(screen.queryByTestId("ring-arc")).toBeNull();
  });
});

describe("Bars", () => {
  const data = [
    { key: "a", label: "S-1", value: 40, detail: "Semana 1: 40%" },
    { key: "b", label: "Act.", value: 80, detail: "Semana 2: 80%" },
  ];

  it("renders one focusable column per datum under a summary label", () => {
    render(<Bars data={data} max={100} ariaLabel="Asistencia: S-1 40%, Act. 80%" />);
    expect(screen.getByRole("group", { name: /Asistencia: S-1 40%/ })).toBeInTheDocument();
    const columns = screen.getAllByTestId("bars-column");
    expect(columns).toHaveLength(2);
    expect(columns[1]).toHaveAttribute("aria-label", "Semana 2: 80%");
    expect(columns[1]).toHaveAttribute("tabindex", "0");
  });

  it("opens the tooltip on focus and closes it on blur", () => {
    render(<Bars data={data} ariaLabel="x" />);
    const [first] = screen.getAllByTestId("bars-column");
    fireEvent.focus(first);
    expect(screen.getByTestId("chart-tooltip").textContent).toBe("Semana 1: 40%");
    fireEvent.blur(first);
    expect(screen.queryByTestId("chart-tooltip")).toBeNull();
  });

  it("opens the tooltip on hover too", () => {
    render(<Bars data={data} ariaLabel="x" />);
    fireEvent.mouseEnter(screen.getAllByTestId("bars-column")[1]);
    expect(screen.getByTestId("chart-tooltip").textContent).toBe("Semana 2: 80%");
  });
});

describe("SegmentBar", () => {
  const segments = [
    { key: "p", label: "Por validar", value: 2, tone: "warn" as const, href: "/payments" },
    { key: "v", label: "Validados", value: 8, tone: "ok" as const, href: "/payments" },
    { key: "r", label: "Rechazados", value: 0, tone: "bad" as const, href: "/payments" },
  ];

  it("draws only the segments that have a value, each a link with its share", () => {
    render(<SegmentBar segments={segments} ariaLabel="Pagos por estado" />);
    const drawn = screen.getAllByTestId("segment");
    expect(drawn).toHaveLength(2);
    expect(drawn[0]).toHaveAttribute("href", "/payments");
    expect(drawn[1]).toHaveAttribute("aria-label", "Validados: 8 (80%)");
  });

  it("states every figure in a text legend, zero included", () => {
    render(<SegmentBar segments={segments} ariaLabel="Pagos por estado" />);
    const legend = screen.getByRole("list");
    expect(within(legend).getByText("Rechazados").closest("li")).toHaveTextContent("0");
  });

  it("falls back to focusable non-link segments without an href, and shows the tooltip on focus", () => {
    render(<SegmentBar segments={[{ key: "a", label: "Alumnos", value: 3 }, { key: "b", label: "Staff", value: 1 }]} ariaLabel="x" hideLegend />);
    const [first] = screen.getAllByTestId("segment");
    expect(first.tagName).toBe("SPAN");
    fireEvent.focus(first);
    expect(screen.getByTestId("chart-tooltip").textContent).toBe("Alumnos: 3 (75%)");
  });
});

describe("StackedBars", () => {
  const series = [
    { key: "present", label: "Presente", tone: "ok" as const },
    { key: "absent", label: "Ausente", tone: "bad" as const },
  ];
  const columns = [
    { key: "w1", label: "Sem. 01/09", values: { present: 5, absent: 1 } },
    { key: "w2", label: "Sem. 08/09", values: { present: 3, absent: 2 } },
  ];
  const props = { series, columns, ariaLabel: "Asistencia por estado", tableCaption: "Asistencia por estado", periodLabel: "Semana" };

  it("names each column with its values and total", () => {
    render(<StackedBars {...props} />);
    const cols = screen.getAllByTestId("stacked-column");
    expect(cols[0]).toHaveAttribute("aria-label", "Sem. 01/09: Presente 5, Ausente 1 · 6 registros");
  });

  it("toggles a series from its legend chip and drops it from the column names", () => {
    render(<StackedBars {...props} />);
    const chip = screen.getByRole("button", { name: /Ausente/ });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "false");
    expect(screen.getAllByTestId("stacked-column")[0]).toHaveAttribute("aria-label", "Sem. 01/09: Presente 5 · 5 registros");
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
  });

  it("opens the tooltip with every visible layer on focus", () => {
    render(<StackedBars {...props} />);
    fireEvent.focus(screen.getAllByTestId("stacked-column")[1]);
    const tip = screen.getByTestId("chart-tooltip");
    expect(tip).toHaveTextContent("Sem. 08/09");
    expect(tip).toHaveTextContent("Presente: 3");
    expect(tip).toHaveTextContent("Ausente: 2");
  });

  it("offers the same figures as a table", () => {
    render(<StackedBars {...props} />);
    const table = screen.getByRole("table", { hidden: true });
    expect(within(table).getByText("Sem. 08/09")).toBeInTheDocument();
    expect(within(table).getAllByRole("row", { hidden: true })).toHaveLength(3);
  });
});

describe("Dots", () => {
  it("names every verdict in one label and marks non-attendance as a ring", () => {
    render(
      <Dots
        ariaLabel="Últimas asistencias de Ana"
        data={[
          { key: "1", label: "01/09 presente", tone: "ok" },
          { key: "2", label: "08/09 ausente", tone: "bad", hollow: true },
        ]}
      />,
    );
    const row = screen.getByRole("img");
    expect(row).toHaveAttribute("aria-label", "Últimas asistencias de Ana: 01/09 presente, 08/09 ausente");
    const dots = row.querySelectorAll("[data-tone]");
    expect(dots[0]).not.toHaveAttribute("data-hollow");
    expect(dots[1]).toHaveAttribute("data-hollow", "true");
  });
});

describe("Timeline", () => {
  const items = [
    { id: "1", start: "15:00", end: "16:00", title: "Formativo", status: "done" as const, statusLabel: "Lista tomada", href: "/trainer/attendance?horario=1" },
    { id: "2", start: "16:00", end: "17:00", title: "Infantil", status: "live" as const, statusLabel: "En curso", note: "8 inscritos", href: "/trainer/attendance?horario=2" },
    { id: "3", start: "17:00", end: "18:00", title: "Juvenil", status: "pending" as const, statusLabel: "Pendiente" },
    { id: "4", start: "14:00", end: "14:30", title: "Adultos", status: "missing" as const, statusLabel: "Sin lista" },
  ];
  const render4 = (now: number | null) => render(<Timeline items={items} nowMinutes={now} ariaLabel="Clases de hoy" />);

  it("draws a block per item, in time order, each named by its whole sentence", () => {
    render4(null);
    const blocks = screen.getAllByTestId("timeline-block");
    expect(blocks.map((b) => b.getAttribute("data-status"))).toEqual(["missing", "done", "live", "pending"]);
    expect(blocks[2]).toHaveAttribute("aria-label", "Infantil, 16:00 a 17:00, En curso, 8 inscritos");
  });

  it("links the blocks that have an href and leaves the others focusable", () => {
    render4(null);
    const blocks = screen.getAllByTestId("timeline-block");
    expect(blocks[1].tagName).toBe("A");
    expect(blocks[3].tagName).toBe("DIV");
    expect(blocks[3]).toHaveAttribute("tabindex", "0");
  });

  it("states the day's progress", () => {
    render4(null);
    expect(screen.getByTestId("timeline-summary")).toHaveTextContent("1 de 4 listas tomadas · 1 en curso · 1 sin lista");
    expect(screen.getByRole("img", { name: /Listas tomadas hoy: 1 de 4/ })).toBeInTheDocument();
  });

  it("marks the current minute with a line and its time when the clock is inside the day", () => {
    render4(16 * 60 + 30);
    expect(screen.getByTestId("timeline-now")).toBeInTheDocument();
    expect(screen.getByTestId("timeline-now-label")).toHaveTextContent("Ahora 16:30");
  });

  it("keeps the chip inside the track near either end of the day", () => {
    const { unmount } = render4(14 * 60 + 10);
    expect(screen.getByTestId("timeline-now-label")).toHaveAttribute("data-align", "start");
    expect(screen.getByTestId("timeline-now-label").className).not.toContain("-translate-x");
    unmount();
    render4(17 * 60 + 50);
    expect(screen.getByTestId("timeline-now-label")).toHaveAttribute("data-align", "end");
    expect(screen.getByTestId("timeline-now-label").className).toContain("-translate-x-full");
  });

  it("centers the chip on the line in the middle of the day", () => {
    render4(16 * 60 + 30);
    expect(screen.getByTestId("timeline-now-label")).toHaveAttribute("data-align", "center");
  });

  it("pins the chip to the edge when the clock is outside the day, without a line", () => {
    render4(9 * 60);
    expect(screen.queryByTestId("timeline-now")).toBeNull();
    expect(screen.getByTestId("timeline-now-label")).toHaveTextContent("Ahora 09:00");
  });

  it("draws no marker without a clock", () => {
    render4(null);
    expect(screen.queryByTestId("timeline-now-label")).toBeNull();
  });

  it("opens the tooltip when a block takes keyboard focus", () => {
    render4(null);
    fireEvent.focus(screen.getAllByTestId("timeline-block")[2]);
    const tip = screen.getByTestId("chart-tooltip");
    expect(tip).toHaveTextContent("Infantil");
    expect(tip).toHaveTextContent("8 inscritos");
  });

  it("paints each block a solid pastel by status, never dashed", () => {
    render4(null);
    const blocks = screen.getAllByTestId("timeline-block");
    const tint = (block: HTMLElement): string =>
      block.querySelector("span[aria-hidden]")?.className ?? "";
    expect(tint(blocks[1])).toContain("bg-state-ok/15");
    expect(tint(blocks[2])).toContain("bg-cuenta-representante/15");
    expect(tint(blocks[3])).toContain("bg-cuenta-menor/10");
    expect(tint(blocks[0])).toContain("bg-state-bad/15");
    // Opaque base, so the hour grid never shows through a block.
    for (const block of blocks) expect(block.className).toContain("bg-paper");
    for (const block of blocks) expect(block.className).not.toContain("dashed");
  });

  it("explains the fills in a legend", () => {
    render4(null);
    const legend = screen.getByRole("list", { name: "Leyenda" });
    for (const word of ["Lista tomada", "En curso", "Pendiente", "Sin lista"]) {
      expect(within(legend).getByText(word)).toBeInTheDocument();
    }
  });

  it("renders nothing for a day it cannot draw", () => {
    const { container } = render(<Timeline items={[{ ...items[0], start: "??", end: "16:00" }]} nowMinutes={null} ariaLabel="x" />);
    expect(container).toBeEmptyDOMElement();
  });
});
