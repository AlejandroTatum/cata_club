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
