/**
 * The «Cumpleaños de hoy» block of the admin dashboard.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import BirthdaysToday from "../BirthdaysToday";

describe("BirthdaysToday", () => {
  it("lists each player with the age they turn", () => {
    render(
      <BirthdaysToday
        birthdays={[
          { nombre: "Ana Gómez", edad: 14 },
          { nombre: "Luis Pérez", edad: 9 },
        ]}
      />,
    );

    const section = screen.getByTestId("birthdays-today");
    expect(within(section).getByRole("heading", { name: "Cumpleaños de hoy" })).toBeInTheDocument();
    const rows = within(section).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Ana Gómez");
    expect(rows[0]).toHaveTextContent("cumple 14");
    expect(rows[1]).toHaveTextContent("Luis Pérez");
    expect(rows[1]).toHaveTextContent("cumple 9");
  });

  it("says in one line that nobody has a birthday today", () => {
    render(<BirthdaysToday birthdays={[]} />);

    const section = screen.getByTestId("birthdays-today");
    expect(within(section).getByText("Hoy no hay cumpleaños")).toBeInTheDocument();
    expect(within(section).queryByRole("list")).toBeNull();
  });
});
