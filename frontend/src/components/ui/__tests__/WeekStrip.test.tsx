/**
 * WeekStrip — seven fixed boxes, always the seven, always in the same order.
 *
 * D9's rule of format: "Los días son siempre siete casillas fijas en el mismo
 * orden". What it replaces is free text — "Mar y jue", "Lun y mié", "Sin
 * horario" — which gave one column four different lengths and made two rows
 * impossible to compare without reading them.
 *
 * The half of the value that is not visual is the accessible label: the letters
 * are POSITIONS OF A SCALE, so the information is carried by shape, and WCAG
 * 1.1.1 asks for a text alternative that says it in words.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import WeekStrip from "@/components/ui/WeekStrip";

/** Every box the strip drew, in the order it drew them. */
function boxes(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-day]"));
}

function letters(container: HTMLElement): string {
  return boxes(container)
    .map((box) => box.textContent ?? "")
    .join("");
}

describe("WeekStrip — seven boxes, always", () => {
  it("draws seven for a two-day schedule", () => {
    const { container } = render(<WeekStrip dias={["mar", "jue"]} />);
    expect(boxes(container)).toHaveLength(7);
  });

  it("draws seven for no schedule at all", () => {
    const { container } = render(<WeekStrip dias={[]} />);
    expect(boxes(container)).toHaveLength(7);
  });

  it("draws seven for a full week", () => {
    const { container } = render(
      <WeekStrip dias={["lun", "mar", "mie", "jue", "vie", "sab", "dom"]} />,
    );
    expect(boxes(container)).toHaveLength(7);
  });

  it("keeps Monday-to-Sunday order whatever order the days arrive in", () => {
    const { container } = render(<WeekStrip dias={["dom", "mie", "lun"]} />);
    expect(boxes(container).map((box) => box.dataset.day)).toEqual([
      "lun",
      "mar",
      "mie",
      "jue",
      "vie",
      "sab",
      "dom",
    ]);
  });

  it("reads as one scale of seven letters", () => {
    // Two Ms in a row are only legible BECAUSE the seven positions are fixed —
    // which is the difference between a scale and an abbreviation.
    const { container } = render(<WeekStrip dias={["mar", "jue"]} />);
    expect(letters(container)).toBe("LMMJVSD");
  });
});

describe("WeekStrip — active and idle", () => {
  it("fills the days that run in the club's red and dims the rest", () => {
    const { container } = render(<WeekStrip dias={["mar", "jue"]} />);
    const [monday, tuesday] = boxes(container);
    expect(tuesday).toHaveClass("bg-cata-red", "text-white");
    expect(monday).toHaveClass("bg-sunken", "text-ink-3-strong");
  });

  it("dims all seven when there is no schedule", () => {
    const { container } = render(<WeekStrip dias={[]} />);
    for (const box of boxes(container)) {
      expect(box).toHaveClass("bg-sunken");
      expect(box).not.toHaveClass("bg-cata-red");
    }
  });

  it("draws no outline on an idle box, because an outline could not be seen anyway", () => {
    // `line` measures 1.219:1 on the idle fill and `line-2` 1.408:1, both far
    // under WCAG 1.4.11's 3:1 (`color-contrast.test.ts`). A border here would
    // be an edge that only looks like it does the work of showing the box.
    const { container } = render(<WeekStrip dias={["mar"]} />);
    for (const box of boxes(container)) {
      expect(Array.from(box.classList).filter((c) => c.startsWith("border"))).toEqual([]);
    }
  });

  it("survives a day sent twice", () => {
    const { container } = render(<WeekStrip dias={["mar", "mar"]} />);
    expect(boxes(container)).toHaveLength(7);
    expect(boxes(container)[1]).toHaveClass("bg-cata-red");
  });
});

describe("WeekStrip — every box carries the whole word", () => {
  it("titles each box with the full day name, accents included", () => {
    const { container } = render(<WeekStrip dias={["mie", "sab"]} />);
    expect(boxes(container).map((box) => box.getAttribute("title"))).toEqual([
      "Lunes",
      "Martes",
      "Miércoles",
      "Jueves",
      "Viernes",
      "Sábado",
      "Domingo",
    ]);
  });
});

describe("WeekStrip — what a screen reader receives", () => {
  it("announces the schedule in whole words, not seven loose letters", () => {
    render(<WeekStrip dias={["mar", "jue"]} />);
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", "Martes y jueves");
  });

  it("keeps the letters themselves out of the accessibility tree", () => {
    const { container } = render(<WeekStrip dias={["mar", "jue"]} />);
    for (const box of boxes(container)) {
      expect(box).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("names a single day on its own", () => {
    render(<WeekStrip dias={["lun"]} />);
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", "Lunes");
  });

  it("commas a three-day week and gives the last one the y", () => {
    render(<WeekStrip dias={["lun", "mie", "vie"]} />);
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", "Lunes, miércoles y viernes");
  });

  it("reads the days in week order, not in the order they were passed", () => {
    render(<WeekStrip dias={["jue", "mar"]} />);
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", "Martes y jueves");
  });

  it("says the empty case in words instead of leaving silence", () => {
    render(<WeekStrip dias={[]} />);
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", "Sin horario");
  });

  it("names the whole week without abbreviating any of it", () => {
    render(<WeekStrip dias={["lun", "mar", "mie", "jue", "vie", "sab", "dom"]} />);
    expect(screen.getByRole("img")).toHaveAttribute(
      "aria-label",
      "Lunes, martes, miércoles, jueves, viernes, sábado y domingo",
    );
  });
});

/**
 * `/groups` is the strip's first caller, and it carries a THIRD day state the
 * two-tone strip has no word for: a categoría has a track of días it is allowed
 * to meet on, and it may not use all of them. The screen drew that as its own
 * `DiaTrack` — a variable-length row of 3-letter pills, five wide for most
 * categorías and six for Competitivo — which is exactly the column of four
 * different lengths the strip was built to end.
 *
 * Folding it in as an optional third tone keeps the format rule (seven boxes,
 * always) without deleting a fact the admin uses to decide. Callers that do not
 * pass `permitidos` get precisely today's two-state strip.
 */
describe("WeekStrip — the días a caller is allowed to use", () => {
  function box(day: string): HTMLElement {
    return document.querySelector(`[data-day="${day}"]`) as HTMLElement;
  }

  it("still draws two tones when no track is given", () => {
    render(<WeekStrip dias={["lun", "mie"]} />);
    expect(box("lun")).toHaveAttribute("data-state", "activo");
    expect(box("mar")).toHaveAttribute("data-state", "inactivo");
  });

  it("marks a día inside the track that the group does not use", () => {
    render(<WeekStrip dias={["lun", "mie"]} permitidos={["lun", "mar", "mie"]} />);
    expect(box("lun")).toHaveAttribute("data-state", "activo");
    expect(box("mar")).toHaveAttribute("data-state", "disponible");
    expect(box("jue")).toHaveAttribute("data-state", "inactivo");
  });

  it("keeps the spoken sentence about the días that RUN, never the track", () => {
    // The label answers "when does this group meet". A track is an option, and
    // reading options out as if they were sessions is a different sentence.
    render(<WeekStrip dias={["lun", "mie"]} permitidos={["lun", "mar", "mie", "jue", "vie"]} />);
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", "Lunes y miércoles");
  });

  it("never lets a track day outrank a day that actually runs", () => {
    render(<WeekStrip dias={["sab"]} permitidos={["lun"]} />);
    expect(box("sab")).toHaveAttribute("data-state", "activo");
  });
});

/**
 * The strip on a coal ground.
 *
 * The idle box is `bg-sunken` — a near-white fill measured against `paper` and
 * `canvas`, the two surfaces a table stands on. Dropped on the carnet's coal
 * credential that same fill is the BRIGHTEST thing on the card, so seven unlit
 * days shout louder than the two that run: the strip's whole message inverts.
 *
 * It is a VARIANT on the component rather than a wrapper selector overriding it
 * from outside, for the reason the file's header already gives about the label:
 * half of this piece is a contract, and a caller repainting it from a parent
 * `[&_span]` rule can silently take the contrast with it. The default is
 * untouched, so `/groups` renders exactly as it did.
 *
 * The measurements, on the coal the credential is drawn in (#131316):
 *   · idle fill `white/5` composites to #1F1F22 — 3.13:1 against the lit red,
 *     clear of WCAG 1.4.11's 3:1, which is what makes "which boxes are lit"
 *     readable at all.
 *   · `text-white/70` on that fill is ~8.5:1, well past AA for a 10.5px bold.
 */
describe("WeekStrip — the same seven boxes on a coal ground", () => {
  it("keeps the club's red for a día that runs, whatever the ground", () => {
    const { container } = render(<WeekStrip dias={["mar"]} variant="onCoal" />);
    expect(boxes(container)[1]).toHaveClass("bg-cata-red", "text-white");
  });

  it("replaces the near-white idle fill instead of shouting off the coal", () => {
    const { container } = render(<WeekStrip dias={["mar"]} variant="onCoal" />);
    const monday = boxes(container)[0];
    expect(monday).not.toHaveClass("bg-sunken");
    expect(monday).not.toHaveClass("text-ink-3-strong");
    expect(monday).toHaveClass("bg-white/5", "text-white/70");
  });

  it("leaves the light-ground strip exactly as `/groups` renders it today", () => {
    const { container } = render(<WeekStrip dias={["mar"]} />);
    expect(boxes(container)[0]).toHaveClass("bg-sunken", "text-ink-3-strong");
  });

  it("keeps the whole-word label and the role a screen reader receives", () => {
    render(<WeekStrip dias={["mar", "jue"]} variant="onCoal" />);
    const strip = screen.getByRole("img");
    expect(strip).toHaveAttribute("aria-label", "Martes y jueves");
    expect(strip).toHaveAttribute("data-testid", "week-strip");
  });

  it("says the empty case in words on coal too, never in silence", () => {
    render(<WeekStrip dias={[]} variant="onCoal" />);
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", "Sin horario");
  });

  it("still tells an available día from an unlit one on the dark ground", () => {
    const { container } = render(
      <WeekStrip dias={["lun"]} permitidos={["lun", "mar"]} variant="onCoal" />,
    );
    const [, tuesday] = boxes(container);
    expect(tuesday).toHaveAttribute("data-state", "disponible");
    expect(tuesday).toHaveClass("border-dashed");
    // `line-2` is a light-surface hairline; on coal it is invisible.
    expect(tuesday).not.toHaveClass("border-line-2");
  });
});
