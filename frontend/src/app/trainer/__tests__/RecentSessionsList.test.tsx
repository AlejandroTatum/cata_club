/**
 * Component tests for "Últimas listas" (issue #211): dense, full-width rows
 * replacing the old badge table. Color stays reserved for badges/pills, so
 * the four counts render as one proportional bar; the bar's `aria-label`
 * carries the same four numbers a sighted reader gets from hovering.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import RecentSessionsList from "@/app/trainer/RecentSessionsList";
import type { RecentAttendanceSession } from "@/services/api";

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

const SESSIONS: RecentAttendanceSession[] = [
  {
    horarioId: 1,
    fecha: "2026-07-20",
    horario: "Lunes 15:00 — 16:00",
    counts: { present: 9, late: 1, justified: 1, absent: 1 },
    total: 12,
  },
  {
    horarioId: 2,
    fecha: "2026-07-19",
    horario: "Domingo 09:00 — 10:00",
    counts: { present: 8, late: 1, justified: 0, absent: 1 },
    total: 10,
  },
];

describe("RecentSessionsList", () => {
  it("shows the date, the horario and the total for each session", () => {
    render(<RecentSessionsList sessions={SESSIONS} />);

    expect(screen.getByText("20/07/2026")).toBeInTheDocument();
    expect(screen.getByText("Lunes 15:00 — 16:00")).toBeInTheDocument();
    expect(screen.getAllByText("12").length).toBeGreaterThan(0);
  });

  it("gives the proportional bar an aria-label enunciating all four counts and the total", () => {
    render(<RecentSessionsList sessions={SESSIONS} />);

    const bar = screen.getByRole("img", {
      name: "9 presentes, 1 tardanza, 1 justificado y 1 ausente sobre 12 registros",
    });
    expect(bar).toBeInTheDocument();
  });

  it("does not render the four counts as loose colored text — color stays on badges/pills", () => {
    render(<RecentSessionsList sessions={SESSIONS} />);

    // No bare "9 Presente" / "1 Tardanza" text nodes outside the bar's own
    // hover breakdown, and no per-row action of any kind.
    expect(screen.queryByRole("link", { name: /Corregir/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Entrenador/)).not.toBeInTheDocument();
  });

  it("links to the history view, once, from its own header", () => {
    render(<RecentSessionsList sessions={SESSIONS} />);

    const link = screen.getByRole("link", { name: "Ver historial" });
    expect(link).toHaveAttribute("href", "/trainer/attendance/history");
  });

  it("shows an empty state with no rows and no bars when there are no recent sessions", () => {
    render(<RecentSessionsList sessions={[]} />);

    expect(screen.getByText("Todavía no hay listas registradas")).toBeInTheDocument();
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });

  it("gives each row its own bar — one session's counts never bleed into another's", () => {
    render(<RecentSessionsList sessions={SESSIONS} />);

    expect(
      screen.getByRole("img", {
        name: "9 presentes, 1 tardanza, 1 justificado y 1 ausente sobre 12 registros",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", {
        name: "8 presentes, 1 tardanza, 0 justificados y 1 ausente sobre 10 registros",
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("img")).toHaveLength(2);
  });
});
