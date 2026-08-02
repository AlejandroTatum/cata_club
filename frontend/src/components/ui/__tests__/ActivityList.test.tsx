/**
 * The activity list is the one list in the product that is deliberately NOT a
 * table, so what it has to prove is that it is still a PRIMITIVE: one row
 * height, one gutter, declared once.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ActivityItem, ActivityList, ActivityListHeader } from "../ActivityList";

function renderFeed(): void {
  render(
    <ActivityList>
      <ActivityItem
        initials="SG"
        subject="Sofía González"
        detail="subió un comprobante"
        at="Hoy, 23 jul"
      />
      <ActivityItem
        initials="PR"
        subject="Pedro Ramírez"
        detail="fue marcado presente"
        at="Ayer"
      />
    </ActivityList>,
  );
}

describe("ActivityItem", () => {
  it("reads as one sentence, with the subject leading it", () => {
    renderFeed();

    const line = screen.getByText("Sofía González").closest("span") as HTMLElement;
    expect(line).toHaveTextContent("Sofía González subió un comprobante");
    expect(screen.getByText("Sofía González")).toHaveClass("font-semibold", "text-ink");
  });

  it("hides the initials from assistive tech, because the sentence says the name", () => {
    renderFeed();

    // "SG" then "Sofía González" is the same fact twice, the second time as
    // noise. The mark is a visual anchor, not information.
    const mark = screen.getByText("SG");
    expect(mark).toHaveAttribute("aria-hidden", "true");
  });

  it("takes the dense-row token, so the feed does not invent a third row height", () => {
    // The dashboard hand-wrote this row with its own `py-3` and no floor, which
    // is how the product ended up with a table row at 60px, a discount row at
    // whatever `py-4` produced, and this one at a third value.
    renderFeed();

    const row = screen.getByText("Sofía González").closest("li") as HTMLElement;
    expect(row).toHaveClass("min-h-drow");
  });

  it("puts the timestamp last and lets the sentence take the slack", () => {
    renderFeed();

    const row = screen.getByText("Sofía González").closest("li") as HTMLElement;
    expect(row.lastElementChild).toHaveTextContent("Hoy, 23 jul");
    // `min-w-0 flex-1` is what lets a long sentence wrap instead of pushing the
    // date out of the card — the reason this is not a fixed column track.
    expect(screen.getByText("Sofía González").parentElement).toHaveClass("min-w-0", "flex-1");
  });
});

describe("ActivityListHeader", () => {
  it("shares the list's gutter, so the title lines up with the actor marks", () => {
    render(<ActivityListHeader title="Actividad reciente" action={<button>Ver todo</button>} />);
    renderFeed();

    const header = screen.getByRole("heading", { name: "Actividad reciente" })
      .parentElement as HTMLElement;
    const row = screen.getByText("Sofía González").closest("li") as HTMLElement;

    const gutter = /px-\[18px\]/;
    expect(header.className).toMatch(gutter);
    expect(row.className).toMatch(gutter);
  });

  it("renders the section heading at h2, under the shell's own h1", () => {
    render(<ActivityListHeader title="Actividad reciente" />);
    expect(screen.getByRole("heading", { level: 2, name: "Actividad reciente" })).toBeInTheDocument();
  });
});

describe("the feed's markup lives in the primitive", () => {
  it("leaves the dashboard writing no row of its own", () => {
    // The acceptance criterion, asserted on the source: the screen may compose
    // the primitive, but it may not re-declare the row. A hand-written `<li>`
    // here is exactly what this file replaces.
    const code = readFileSync(
      join(__dirname, "..", "..", "..", "app", "dashboard", "page.tsx"),
      "utf8",
    );

    expect(code).toContain("ActivityItem");
    expect(code).not.toMatch(/<li\b/);
  });
});
