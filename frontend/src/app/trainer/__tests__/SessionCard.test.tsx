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
 * ## Renegotiated: the rest of today is a rail, not a stack of rows
 *
 * The band used to close with an `<ol>` of one 40px row per remaining session,
 * and the owner's complaint about it was about SIZE — "me ponen un rectángulo
 * negro gigante". A list of rows is the one shape that answers a complaint
 * about height by growing: three sessions cost ~100px of band, six cost ~200px.
 *
 * So the day is drawn along the band's WIDTH instead, as a rail: one block per
 * session, positioned and sized by its own hours, with a marker at the current
 * minute. The band's height stops depending on how many sessions the day has.
 * The assertions that moved are named at their call sites; which session leads,
 * which link it carries and how the CTA is worded did not move.
 *
 * ## What the rail may say
 *
 * A `TrainingSchedule` is four fields — `id`, `diaSemana`, `horaInicio`,
 * `horaFin`. There is no session name, category, level or per-session status
 * anywhere in it, so a block can carry an hour and nothing else, and these
 * tests assert exactly that much and never a label the data cannot support.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import SessionCard from "@/app/trainer/SessionCard";
import type { TrainingSchedule } from "@/app/attendance/attendance-utils";
import { buildDayRail, type SessionCardState } from "@/app/trainer/trainer-day-utils";

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

/** A clock time on the fixture's day — the rail only ever reads hours/minutes. */
function at(hours: number, minutes: number): Date {
  return new Date(2026, 6, 23, hours, minutes);
}

/** Every anchor in the container whose href addresses a specific session. */
function horarioLinks(container: HTMLElement): HTMLAnchorElement[] {
  return Array.from(container.querySelectorAll<HTMLAnchorElement>("a[href*='horario=']"));
}

const NEXT_AT_15: SessionCardState = {
  kind: "next",
  schedule: schedule(7, "15:00", "16:00"),
  minutesAway: 25,
  later: [],
};

describe("SessionCard", () => {
  it("renders nothing for a rest day / loading / error — state is null", () => {
    const { container } = render(<SessionCard state={null} rail={null} enrolledCounts={{}} />);
    expect(container).toBeEmptyDOMElement();
  });

  /*
   * Renegotiated in the trainer sweep of the visual redesign, with the reason
   * written: this used to assert the raw minute count as the 46px figure
   * (`getByText("25")`). A minute count only reads as a quantity for about an
   * hour — the panel opened at 03:20 on a Friday whose first session is at
   * 15:00 printed "700 minutos" — so the figure is now the session's own
   * identifier, its start hour, in BOTH states, and the wait is said in words
   * underneath.
   *
   * Lo que sí cambió después: la banda se quedó sin acciones. Llevaba "Pasar
   * lista de las 15:00" y "Elegir otro horario", los dos hacia el asistente
   * para tomar la lista, que se retiró de la interfaz mientras se rehace
   * dentro del área de miembros. La tarjeta informa y no navega.
   */
  it("'next': the hour is the big number, the wait is said in words, and the band carries no action", () => {
    render(
      <SessionCard
        state={NEXT_AT_15}
        rail={buildDayRail([schedule(7, "15:00", "16:00")], at(14, 35))}
        enrolledCounts={{ 7: 12 }}
      />,
    );

    expect(screen.getByText("15:00")).toBeInTheDocument();
    expect(screen.getByText("Próxima sesión")).toBeInTheDocument();
    expect(screen.getByText("Empieza en 25 minutos")).toBeInTheDocument();
    // The number that used to be here said nothing on its own.
    expect(screen.queryByText("25")).not.toBeInTheDocument();
    expect(screen.getByText("Lunes 15:00 — 16:00")).toBeInTheDocument();
    expect(screen.getByText(/12 estudiantes inscritos/)).toBeInTheDocument();

    // Ni un ancla ni un botón: no queda acción que la banda pueda ofrecer.
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("'live': the start hour stays the big number, and 'En curso' is written, not only colored", () => {
    const state: SessionCardState = {
      kind: "live",
      schedule: schedule(7, "15:00", "16:00"),
      minutesElapsed: 10,
      later: [],
    };
    render(
      <SessionCard
        state={state}
        rail={buildDayRail([schedule(7, "15:00", "16:00")], at(15, 10))}
        enrolledCounts={{ 7: 12 }}
      />,
    );

    // The number that used to be the countdown is now the start hour.
    expect(screen.getByText("15:00")).toBeInTheDocument();
    expect(screen.getByText("En curso")).toBeInTheDocument();
    expect(screen.getByText(/Hace 10 minutos/)).toBeInTheDocument();

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // The rail. The owner's complaint was the band's HEIGHT, so the day is drawn
  // along its width: every session of today, placed by its own hour.
  // -------------------------------------------------------------------------

  const DAY = [
    schedule(5, "13:00", "14:00"),
    schedule(7, "15:00", "16:00"),
    schedule(8, "17:00", "18:00"),
  ];

  it("draws every session of the day, each block as wide as the session is long", () => {
    render(
      <SessionCard
        state={NEXT_AT_15}
        rail={buildDayRail(DAY, at(14, 35))}
        enrolledCounts={{ 5: 4, 7: 12, 8: 3 }}
      />,
    );

    // Window 13:00–18:00 is 300 minutes, so each one-hour session is 20% wide.
    const blocks = screen.getAllByRole("listitem");
    expect(blocks).toHaveLength(3);
    expect(blocks.map((b) => [b.style.left, b.style.width])).toEqual([
      ["0%", "20%"],
      ["40%", "20%"],
      ["80%", "20%"],
    ]);
  });

  it("tells each block apart by where the clock is, and says so in the markup, not only in colour", () => {
    render(
      <SessionCard
        state={NEXT_AT_15}
        rail={buildDayRail(DAY, at(15, 30))}
        enrolledCounts={{ 5: 4, 7: 12, 8: 3 }}
      />,
    );

    expect(screen.getAllByRole("listitem").map((b) => b.dataset.phase)).toEqual([
      "past",
      "live",
      "upcoming",
    ]);
  });

  /*
   * The accessible equivalent, and why it is THIS one.
   *
   * The rail is a picture: the blocks carry no text, so on their own they say
   * nothing at all to a screen reader. The band's previous `<ol role="list">`
   * was deliberate (Safari/VoiceOver drops the implicit list role once
   * `list-none` removes the bullets) and giving that up would be a regression,
   * so the rail IS that list — the track is the `<ol>`, each block is a real
   * `<li>`, and the day is still walked item by item with no custom scroll
   * region and no roving tabindex.
   *
   * What each block says is an `aria-label`, which is the same move
   * `buildSessionBarAriaLabel` already makes for the proportional bar on this
   * screen: a graphic with no text of its own is named. The alternative — a
   * second, visually hidden copy of the list — would put every count in the
   * tree twice and make the band's own support line read out again.
   *
   * The label says "a" where the visible line says "—": an em dash is read as
   * a pause or as nothing, and a spoken range needs a word.
   */
  it("is a real list a screen reader can walk, every block named by hour, phase and roster count", () => {
    render(
      <SessionCard
        state={NEXT_AT_15}
        rail={buildDayRail(DAY, at(15, 30))}
        enrolledCounts={{ 5: 4, 7: 12, 8: 3 }}
      />,
    );

    const rail = screen.getByRole("list", { name: "Sus sesiones de hoy" });
    expect(within(rail).getAllByRole("listitem")).toHaveLength(3);

    expect(
      screen.getByRole("listitem", { name: "13:00 a 14:00, terminada, 4 estudiantes inscritos" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("listitem", { name: "15:00 a 16:00, en curso, 12 estudiantes inscritos" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("listitem", { name: "17:00 a 18:00, por venir, 3 estudiantes inscritos" }),
    ).toBeInTheDocument();
  });

  it("leaves the roster count out of a block's name while the roster is unknown, rather than saying zero", () => {
    render(<SessionCard state={NEXT_AT_15} rail={buildDayRail(DAY, at(15, 30))} enrolledCounts={{}} />);

    expect(screen.getByRole("listitem", { name: "15:00 a 16:00, en curso" })).toBeInTheDocument();
  });

  it("marks the current minute on the rail", () => {
    const { container } = render(
      <SessionCard state={NEXT_AT_15} rail={buildDayRail(DAY, at(15, 30))} enrolledCounts={{}} />,
    );

    // 13:00–18:00 is 300 minutes and 15:30 is 150 of them in: dead centre.
    const marker = container.querySelector<HTMLElement>("[data-rail='now']");
    expect(marker).not.toBeNull();
    expect(marker?.style.left).toBe("50%");
  });

  it("draws no marker at an hour the day does not cover — 03:20 is not standing at 13:00", () => {
    const { container } = render(
      <SessionCard state={NEXT_AT_15} rail={buildDayRail(DAY, at(3, 20))} enrolledCounts={{}} />,
    );

    expect(container.querySelector("[data-rail='now']")).toBeNull();
  });

  it("degrades a one-session day to a single full-width row", () => {
    render(
      <SessionCard
        state={NEXT_AT_15}
        rail={buildDayRail([schedule(7, "15:00", "16:00")], at(14, 35))}
        enrolledCounts={{ 7: 12 }}
      />,
    );

    const blocks = screen.getAllByRole("listitem");
    expect(blocks).toHaveLength(1);
    expect([blocks[0].style.left, blocks[0].style.width]).toEqual(["0%", "100%"]);
  });

  it("stacks overlapping sessions into rows instead of hiding one behind the other", () => {
    // The club runs two categories at once: `fetchTrainingSchedules` returns
    // every horario of the day, not one trainer's.
    render(
      <SessionCard
        state={NEXT_AT_15}
        rail={buildDayRail(
          [schedule(7, "15:00", "16:00"), schedule(9, "15:00", "16:00")],
          at(15, 30),
        )}
        enrolledCounts={{}}
      />,
    );

    const blocks = screen.getAllByRole("listitem");
    expect(blocks).toHaveLength(2);
    // Same hours, so same geometry across the rail — told apart by their row.
    expect(blocks.map((b) => b.style.left)).toEqual(["0%", "0%"]);
    expect(blocks.map((b) => b.style.top)).not.toEqual([blocks[0].style.top, blocks[0].style.top]);
  });

  /*
   * The complaint, asserted as a structure rather than as a measurement.
   *
   * jsdom lays nothing out, so a pixel height cannot be read here. What CAN be
   * locked is the property that produced the height: the band used to gain a
   * ~40px row per session and now gains nothing at all, because the day is one
   * rail whatever it holds.
   */
  it("does not grow a row when the day gains sessions", () => {
    const two = render(
      <SessionCard
        state={NEXT_AT_15}
        rail={buildDayRail([schedule(7, "15:00", "16:00"), schedule(8, "17:00", "18:00")], at(15, 30))}
        enrolledCounts={{}}
      />,
    );
    const short = two.container.querySelector("section")!.children.length;

    const six = render(
      <SessionCard
        state={NEXT_AT_15}
        rail={buildDayRail(
          [
            schedule(1, "08:00", "09:00"),
            schedule(2, "09:00", "10:00"),
            schedule(3, "10:00", "11:00"),
            schedule(7, "15:00", "16:00"),
            schedule(8, "17:00", "18:00"),
            schedule(9, "19:00", "20:00"),
          ],
          at(15, 30),
        )}
        enrolledCounts={{}}
      />,
    );

    expect(six.container.querySelector("section")!.children.length).toBe(short);
    expect(within(six.container).getAllByRole("listitem")).toHaveLength(6);
  });

  it("renders the band without a rail rather than failing when the day cannot be drawn", () => {
    // `buildDayRail` returns null on a day whose every `horaInicio` is
    // unparseable. The hero still has a session to point at, so the band stays.
    render(<SessionCard state={NEXT_AT_15} rail={null} enrolledCounts={{ 7: 12 }} />);

    expect(screen.getByText("15:00")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Sus sesiones de hoy" })).not.toBeInTheDocument();
    expect(screen.getByText("Lunes 15:00 — 16:00")).toBeInTheDocument();
  });

  it("never leaves a horario= link inside the rail, whatever it draws", () => {
    const { container } = render(
      <SessionCard
        state={NEXT_AT_15}
        rail={buildDayRail(DAY, at(15, 30))}
        enrolledCounts={{ 5: 4, 7: 12, 8: 3 }}
      />,
    );

    const rail = screen.getByRole("list", { name: "Sus sesiones de hoy" });
    // The rail is context, not a CTA — and now nothing else in the band is one
    // either, so the whole card has to come back without a single anchor.
    expect(rail.querySelectorAll("a, button")).toHaveLength(0);
    expect(horarioLinks(container)).toHaveLength(0);
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  it("'done': says the day is over and offers nothing — no link, generic or otherwise", () => {
    const { container } = render(
      <SessionCard state={{ kind: "done" }} rail={null} enrolledCounts={{}} />,
    );

    expect(screen.getByText("Ya no quedan sesiones hoy.")).toBeInTheDocument();
    // "Elegir otro horario" vivía acá y apuntaba al selector del asistente.
    expect(screen.queryByRole("link", { name: "Elegir otro horario" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Pasar lista/ })).not.toBeInTheDocument();
    expect(horarioLinks(container)).toHaveLength(0);
  });

  it("never leaves a horario= link anywhere for the three no-session states", () => {
    const nullRender = render(<SessionCard state={null} rail={null} enrolledCounts={{}} />);
    expect(horarioLinks(nullRender.container)).toHaveLength(0);

    const doneRender = render(
      <SessionCard state={{ kind: "done" }} rail={null} enrolledCounts={{}} />,
    );
    expect(horarioLinks(doneRender.container)).toHaveLength(0);
  });
});
