/**
 * The shared dashboard pieces: the context line, the attention strip, the
 * soft section notice and the status rows.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import AttentionStrip from "../AttentionStrip";
import CompactEmpty from "../CompactEmpty";
import SectionNotice from "../SectionNotice";
import StatusRowList from "../StatusRowList";
import KpiTile from "../KpiTile";
import TimelineDayList from "../TimelineDayList";
import { buildContextLine, formatClubLongDate } from "../context-line";

describe("formatClubLongDate", () => {
  it("spells the club's day, not the device's", () => {
    // 03:00 UTC on the 30th is still the 29th at the club (UTC-5).
    expect(formatClubLongDate(new Date("2026-09-30T03:00:00Z"))).toBe("martes, 29 de septiembre de 2026");
  });

  it("prefixes the role", () => {
    expect(buildContextLine("Entrenador", new Date("2026-01-05T17:00:00Z"))).toBe(
      "Entrenador · lunes, 5 de enero de 2026",
    );
  });
});

describe("AttentionStrip", () => {
  it("renders one row per item with its own action", () => {
    render(
      <AttentionStrip
        title="Requiere su atención"
        allClearMessage="Todo al día"
        items={[
          { id: "a", count: 4, label: "pagos esperan su validación", note: "1 lleva más de una semana", href: "/payments", cta: "Revisar" },
        ]}
      />,
    );
    const row = screen.getByText("pagos esperan su validación").closest("li") as HTMLElement;
    expect(within(row).getByText("4")).toBeInTheDocument();
    expect(within(row).getByText("1 lleva más de una semana")).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: /revisar/i })).toHaveAttribute("href", "/payments");
    expect(screen.queryByText("Todo al día")).toBeNull();
  });

  it("says all clear when there are no items", () => {
    render(<AttentionStrip title="Requiere su atención" allClearMessage="Todo al día" items={[]} />);
    expect(screen.getByText("Todo al día")).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });
});

describe("SectionNotice", () => {
  it("announces politely and retries on demand", () => {
    const onRetry = vi.fn();
    render(<SectionNotice message="No se pudo cargar." onRetry={onRetry} />);
    expect(screen.getByRole("status")).toHaveTextContent("No se pudo cargar.");
    screen.getByRole("button", { name: /reintentar/i }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("offers no button when there is nothing to retry", () => {
    render(<SectionNotice message="Aviso" />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("StatusRowList", () => {
  it("shows title, detail, status badge and the row action", () => {
    render(
      <StatusRowList
        rows={[
          { id: 1, title: "15:00 — 16:00", detail: "Sub-12", status: { tone: "ok", label: "Lista tomada" }, action: <a href="/x">Abrir</a> },
        ]}
      />,
    );
    const row = screen.getByRole("listitem");
    expect(within(row).getByText("15:00 — 16:00")).toBeInTheDocument();
    expect(within(row).getByText("Sub-12")).toBeInTheDocument();
    expect(within(row).getByText("Lista tomada")).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "Abrir" })).toBeInTheDocument();
  });
});

describe("CompactEmpty", () => {
  it("is a single status line: title, hint and an optional action, never a tall card", () => {
    render(
      <CompactEmpty title="Todo al día" description="No hay nada por revisar." action={<a href="/x">Ir</a>} />,
    );
    const line = screen.getByTestId("compact-empty");
    expect(within(line).getByText("Todo al día")).toBeInTheDocument();
    expect(within(line).getByText("No hay nada por revisar.")).toBeInTheDocument();
    expect(within(line).getByRole("link", { name: "Ir" })).toBeInTheDocument();
    expect(line.className).not.toMatch(/\bmin-h-|\bh-full\b|\bflex-1\b/);
  });
});

describe("KpiTile", () => {
  it("lets a side picture wrap under the figure instead of overflowing a narrow tile", () => {
    render(<KpiTile label="Pagos" value="8" visual={<span>picture</span>} caption="Ver" />);
    expect(screen.getByTestId("kpi-tile").querySelector(".flex-wrap")).not.toBeNull();
  });
});

describe("TimelineDayList", () => {
  it("writes each session in full, linking into its attendance when it has one", () => {
    render(
      <TimelineDayList
        items={[
          { id: "a", start: "15:00", end: "16:00", title: "Formativo", status: "pending", statusLabel: "Pendiente", href: "/trainer/attendance?horario=1" },
          { id: "b", start: "16:00", end: "17:00", title: "Avanzado", status: "done", statusLabel: "Lista tomada", note: "12 inscritos" },
        ]}
      />,
    );
    const rows = within(screen.getByTestId("timeline-day-list")).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("15:00 – 16:00");
    expect(rows[0]).toHaveTextContent("Pendiente");
    expect(within(rows[0]).getByRole("link").getAttribute("href")).toBe("/trainer/attendance?horario=1");
    expect(rows[1]).toHaveTextContent("Lista tomada · 12 inscritos");
    expect(within(rows[1]).queryByRole("link")).toBeNull();
  });
});

describe("KpiTile caption link", () => {
  it("accepts a taller tap area for the caption link", () => {
    render(<KpiTile label="Alumnos" value={8} caption="8 alumnos" href="/members" captionClassName="max-lg:min-h-[44px]" />);
    expect(screen.getByRole("link", { name: /8 alumnos/ }).className).toContain("max-lg:min-h-[44px]");
  });
});
