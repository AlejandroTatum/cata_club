/**
 * DataRow — the dense list row that replaces the avatar card: with 86 people
 * on one screen, a card forces twice the scrolling a row does. One component,
 * two densities (`dense` and `two-line`), never two components.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import DataRow, { DataRowList } from "@/components/ui/DataRow";
import DataBox from "@/components/ui/DataBox";
import Badge from "@/components/ui/Badge";

describe("DataRow — identity", () => {
  it("renders the name in semibold", () => {
    render(<DataRow name="Laura Vera" />);
    expect(screen.getByText("Laura Vera")).toHaveClass("font-semibold");
  });
});

describe("DataRow — dense variant", () => {
  it("renders metadata passed as DataBox values", () => {
    render(
      <DataRow name="Laura Vera" meta={<DataBox>32 años</DataBox>} />,
    );
    expect(screen.getByText("32 años")).toHaveClass("bg-sunken");
  });

  it("ignores subtitle in the dense variant — metadata carries the second value", () => {
    render(<DataRow name="Laura Vera" meta={<DataBox>32 años</DataBox>} subtitle="Representante" />);
    expect(screen.queryByText("Representante")).not.toBeInTheDocument();
  });
});

describe("DataRow — two-line variant", () => {
  it("puts the name above and the second value below it, muted", () => {
    render(<DataRow variant="two-line" name="Laura Vera" subtitle="Representante" />);
    expect(screen.getByText("Laura Vera")).toHaveClass("font-semibold");
    expect(screen.getByText("Representante")).toHaveClass("text-ink-3");
  });

  it("does not render a dense metadata row in the two-line variant", () => {
    render(
      <DataRow
        variant="two-line"
        name="Laura Vera"
        subtitle="Representante"
        meta={<DataBox>32 años</DataBox>}
      />,
    );
    expect(screen.queryByText("32 años")).not.toBeInTheDocument();
  });

  it("omits the subtitle line entirely when there is none", () => {
    render(<DataRow variant="two-line" name="Ana Garcia" />);
    expect(screen.queryByText("Representante")).not.toBeInTheDocument();
  });
});

describe("DataRow — status and actions", () => {
  it("renders an optional status badge", () => {
    render(<DataRow name="Laura Vera" status={<Badge tone="ok">Activa</Badge>} />);
    expect(screen.getByText("Activa")).toHaveClass("bg-state-ok-bg");
  });

  it("renders trailing actions", () => {
    render(<DataRow name="Laura Vera" actions={<button type="button">Editar</button>} />);
    expect(screen.getByRole("button", { name: "Editar" })).toBeInTheDocument();
  });

  it("omits status and actions when neither is supplied", () => {
    render(<DataRow name="Laura Vera" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("lets a crowded action group wrap instead of being clipped (issue #767)", () => {
    // Measured on `/members` at 360px: the shell's `px-4` leaves 328, the card
    // border 326 and this row's own `px-4` 294px of line, and the three row
    // triggers need ~286. It fits by 8px. At 320px — or at 360px with the OS
    // text size above 100% — it does not, and `flex-none` + `whitespace-nowrap`
    // meant the group overflowed WHOLE: `card overflow-hidden` on the page then
    // clipped "Editar" with no scrollbar and no way to reach it.
    render(
      <DataRow
        name="Laura Vera"
        actions={
          <>
            <button type="button">Ficha médica</button>
            <button type="button">Pagos</button>
            <button type="button">Editar</button>
          </>
        }
      />,
    );
    const group = screen.getByRole("button", { name: "Editar" }).parentElement as HTMLElement;

    expect(group.className).toContain("flex-wrap");
    // `flex-none` has to go with it. A box that cannot give up width is sized
    // to its content, so it overflows the line before its children ever wrap.
    expect(group.className).not.toContain("flex-none");
  });
});

describe("DataRow — nameWrap opt-in", () => {
  it("truncates the name by default — protects the other five pages using DataRow", () => {
    render(<DataRow name="Membresía Mensual Categoría Competitiva Avanzada" />);
    expect(screen.getByText("Membresía Mensual Categoría Competitiva Avanzada")).toHaveClass(
      "truncate",
    );
  });

  it("wraps the full name instead of truncating it when nameWrap is set", () => {
    render(<DataRow name="Membresía Mensual Categoría Competitiva Avanzada" nameWrap />);
    const nameEl = screen.getByText("Membresía Mensual Categoría Competitiva Avanzada");
    expect(nameEl).not.toHaveClass("truncate");
    expect(nameEl).toHaveClass("break-words");
  });
});

describe("DataRow — the name column's floor", () => {
  /**
   * jsdom computes no layout, so this can only pin the declaration; the
   * measurement that proves what it does lives in
   * `tests/e2e/tarifas-name-column.spec.ts` (50px → 324px at 390px). Both
   * matter: #660 and #677 were two different failures of the SAME 50px
   * column, and each shipped with the class its page had asked for.
   */
  it("reserves a flex basis for the name so a tight row wraps instead of crushing it", () => {
    render(<DataRow name="Laura Vera" meta={<DataBox>32 años</DataBox>} />);
    const column = screen.getByText("Laura Vera").parentElement;
    expect(column).toHaveClass("flex-1", "basis-56", "min-w-0");
  });

  it("keeps the trailing groups at their natural size — the row breaks, the controls do not shrink", () => {
    render(<DataRow name="Laura Vera" meta={<DataBox>32 años</DataBox>} />);
    expect(screen.getByText("32 años").parentElement).toHaveClass("flex-none");
    expect(screen.getByRole("listitem")).toHaveClass("flex-wrap");
  });
});

describe("DataRowList", () => {
  it("wraps rows in a list with an outer border and inner separators", () => {
    render(
      <DataRowList>
        <DataRow name="Laura Vera" />
        <DataRow name="Ana Garcia" />
      </DataRowList>,
    );
    const list = screen.getByRole("list");
    expect(list).toHaveClass("border", "border-line", "divide-y", "divide-line");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});
