/**
 * Component tests for the trainer dashboard's immediate-session card
 * (issue #211, `docs/archive/prototypes/prototipos/31-entrenador-dashboard-alternativas.html`).
 *
 * The safety rule this file exists to lock down: of the four states, THREE
 * carry no session to point at (done, and — one level up — rest day and
 * error/loading, both of which never mount this component at all). None of
 * those three may ever leave a `horario=` link in the tree, not even one
 * that is hidden or unreachable by tab.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import SessionCard from "@/app/trainer/SessionCard";
import type { TrainingSchedule } from "@/app/attendance/attendance-utils";
import type { SessionCardState } from "@/app/trainer/trainer-day-utils";

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

function schedule(id: number, horaInicio: string, horaFin: string): TrainingSchedule {
  return { id, diaSemana: "lun", horaInicio, horaFin };
}

/** Every anchor in the container whose href addresses a specific session. */
function horarioLinks(container: HTMLElement): HTMLAnchorElement[] {
  return Array.from(container.querySelectorAll<HTMLAnchorElement>("a[href*='horario=']"));
}

describe("SessionCard", () => {
  it("renders nothing for a rest day / loading / error — state is null", () => {
    const { container } = render(<SessionCard state={null} enrolledCounts={{}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("'next': the countdown is the big number, and the primary action names the session by its hour", () => {
    const state: SessionCardState = {
      kind: "next",
      schedule: schedule(7, "15:00", "16:00"),
      minutesAway: 25,
      href: "/trainer/attendance?horario=7&paso=lista",
      later: [],
    };
    render(<SessionCard state={state} enrolledCounts={{ 7: 12 }} />);

    expect(screen.getByText("25")).toBeInTheDocument();
    expect(screen.getByText("Lunes 15:00 — 16:00")).toBeInTheDocument();
    expect(screen.getByText(/12 estudiantes inscritos/)).toBeInTheDocument();

    const primary = screen.getByRole("link", { name: "Pasar lista de las 15:00" });
    expect(primary).toHaveAttribute("href", "/trainer/attendance?horario=7&paso=lista");
    expect(screen.getByRole("link", { name: "Elegir otro horario" })).toHaveAttribute(
      "href",
      "/trainer/attendance",
    );
  });

  it("'live': the start hour becomes the big number, and 'En curso' is written, not only colored", () => {
    const state: SessionCardState = {
      kind: "live",
      schedule: schedule(7, "15:00", "16:00"),
      minutesElapsed: 10,
      href: "/trainer/attendance?horario=7&paso=lista",
      later: [],
    };
    render(<SessionCard state={state} enrolledCounts={{ 7: 12 }} />);

    // The number that used to be the countdown is now the start hour.
    expect(screen.getByText("15:00")).toBeInTheDocument();
    expect(screen.getByText("En curso")).toBeInTheDocument();
    expect(screen.getByText(/Hace 10 minutos/)).toBeInTheDocument();

    const primary = screen.getByRole("link", { name: "Pasar lista de las 15:00" });
    expect(primary).toHaveAttribute("href", "/trainer/attendance?horario=7&paso=lista");
  });

  // -------------------------------------------------------------------------
  // "The rest of today" — QA's actual complaint: five short lines stretched
  // to fill a 470px card, with mt-auto leaving the surplus dead in the
  // middle. The fix fills it with every OTHER session still to come today.
  // -------------------------------------------------------------------------

  it("lists every remaining session today as a proper list, each one written as 'Por venir'", () => {
    const state: SessionCardState = {
      kind: "next",
      schedule: schedule(7, "15:00", "16:00"),
      minutesAway: 25,
      href: "/trainer/attendance?horario=7&paso=lista",
      later: [schedule(8, "16:00", "17:00"), schedule(9, "17:00", "18:00")],
    };
    // 9 has 0 enrolled — a correct, seeded value (issue #211: no fabricated
    // capacity/attendance), not a missing-data blank, so it still shows.
    render(<SessionCard state={state} enrolledCounts={{ 7: 12, 8: 1, 9: 0 }} />);

    const list = screen.getByRole("list", { name: "Después, más tarde hoy" });
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);

    expect(screen.getByText("16:00 — 17:00")).toBeInTheDocument();
    expect(screen.getByText("17:00 — 18:00")).toBeInTheDocument();
    expect(screen.getByText(/1 estudiante inscrito\b/)).toBeInTheDocument();
    expect(screen.getByText(/0 estudiantes inscritos/)).toBeInTheDocument();
    // Written, not only positioned or colored.
    expect(screen.getAllByText("Por venir")).toHaveLength(2);
    // None of this is interactive — it is context, not a second CTA.
    expect(list.querySelectorAll("a, button")).toHaveLength(0);
  });

  it("renders a single later session as one plain row — nothing carousel-shaped to look odd", () => {
    const state: SessionCardState = {
      kind: "next",
      schedule: schedule(7, "15:00", "16:00"),
      minutesAway: 25,
      href: "/trainer/attendance?horario=7&paso=lista",
      later: [schedule(8, "16:00", "17:00")],
    };
    render(<SessionCard state={state} enrolledCounts={{}} />);

    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("16:00 — 17:00")).toBeInTheDocument();
  });

  it("says the hero session is the last one, with no list at all, when nothing else remains today", () => {
    const state: SessionCardState = {
      kind: "live",
      schedule: schedule(7, "15:00", "16:00"),
      minutesElapsed: 10,
      href: "/trainer/attendance?horario=7&paso=lista",
      later: [],
    };
    render(<SessionCard state={state} enrolledCounts={{ 7: 12 }} />);

    expect(screen.getByText("Es tu última sesión de hoy.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Después, más tarde hoy" })).not.toBeInTheDocument();
  });

  it("never leaves a horario= link inside the 'rest of today' list, whatever it shows", () => {
    const state: SessionCardState = {
      kind: "next",
      schedule: schedule(7, "15:00", "16:00"),
      minutesAway: 25,
      href: "/trainer/attendance?horario=7&paso=lista",
      later: [schedule(8, "16:00", "17:00"), schedule(9, "17:00", "18:00")],
    };
    const { container } = render(<SessionCard state={state} enrolledCounts={{}} />);

    // Exactly the two real actions carry a link — nothing per later-session row.
    expect(horarioLinks(container)).toHaveLength(1);
    expect(container.querySelectorAll("a")).toHaveLength(2);
  });

  it("'done': no countdown, and the only action is the generic 'Elegir otro horario' — no session link at all", () => {
    const { container } = render(<SessionCard state={{ kind: "done" }} enrolledCounts={{}} />);

    expect(screen.getByRole("link", { name: "Elegir otro horario" })).toHaveAttribute(
      "href",
      "/trainer/attendance",
    );
    expect(screen.queryByRole("link", { name: /Pasar lista/ })).not.toBeInTheDocument();
    expect(horarioLinks(container)).toHaveLength(0);
  });

  it("never leaves a horario= link anywhere for the three no-session states", () => {
    const nullRender = render(<SessionCard state={null} enrolledCounts={{}} />);
    expect(horarioLinks(nullRender.container)).toHaveLength(0);

    const doneRender = render(<SessionCard state={{ kind: "done" }} enrolledCounts={{}} />);
    expect(horarioLinks(doneRender.container)).toHaveLength(0);
  });
});
