/**
 * The «Cumpleaños de hoy» block of the admin dashboard.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import BirthdaysToday from "../BirthdaysToday";

const people = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    nombre: `Jugador ${String(index + 1).padStart(2, "0")}`,
    edad: 8 + (index % 10),
  }));

describe("BirthdaysToday", () => {
  it("lists each player with the age they turn and the total in the header", () => {
    render(
      <BirthdaysToday
        birthdays={[
          { nombre: "Ana Gómez", edad: 14 },
          { nombre: "Luis Pérez", edad: 9 },
        ]}
      />,
    );

    const section = screen.getByTestId("birthdays-today");
    expect(within(section).getByRole("heading", { name: "Cumpleaños de hoy (2)" })).toBeInTheDocument();
    const rows = within(section).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Ana Gómez");
    expect(rows[0]).toHaveTextContent("cumple 14");
    expect(rows[1]).toHaveTextContent("Luis Pérez");
    expect(rows[1]).toHaveTextContent("cumple 9");
  });

  it("shows no pager when everything fits in one page", () => {
    render(<BirthdaysToday birthdays={people(5)} />);

    const section = screen.getByTestId("birthdays-today");
    expect(within(section).getAllByRole("listitem")).toHaveLength(5);
    expect(within(section).queryByText(/Página \d+ de \d+/)).toBeNull();
    expect(within(section).queryByRole("button", { name: "Página siguiente" })).toBeNull();
  });

  it("shows only the first page of five and the count in the header", () => {
    render(<BirthdaysToday birthdays={people(43)} />);

    const section = screen.getByTestId("birthdays-today");
    expect(within(section).getByRole("heading", { name: "Cumpleaños de hoy (43)" })).toBeInTheDocument();
    const rows = within(section).getAllByRole("listitem");
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent("Jugador 01");
    expect(rows[4]).toHaveTextContent("Jugador 05");
    expect(within(section).getByText("Página 1 de 9")).toBeInTheDocument();
    expect(within(section).getByText(/1–5 de 43/)).toBeInTheDocument();
  });

  it("navigates to the next and previous pages", () => {
    render(<BirthdaysToday birthdays={people(12)} />);
    const section = screen.getByTestId("birthdays-today");

    fireEvent.click(within(section).getByRole("button", { name: "Página siguiente" }));
    let rows = within(section).getAllByRole("listitem");
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent("Jugador 06");
    expect(within(section).getByText("Página 2 de 3")).toBeInTheDocument();

    fireEvent.click(within(section).getByRole("button", { name: "Página siguiente" }));
    rows = within(section).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveTextContent("Jugador 12");
    expect(within(section).getByRole("button", { name: "Página siguiente" })).toBeDisabled();

    fireEvent.click(within(section).getByRole("button", { name: "Página anterior" }));
    expect(within(section).getAllByRole("listitem")[0]).toHaveTextContent("Jugador 06");
  });

  it("does not collapse two players who share a name and an age", () => {
    render(
      <BirthdaysToday
        birthdays={[
          { nombre: "Ana Gómez", edad: 10 },
          { nombre: "Ana Gómez", edad: 10 },
        ]}
      />,
    );

    expect(within(screen.getByTestId("birthdays-today")).getAllByRole("listitem")).toHaveLength(2);
  });

  it("says in one line that nobody has a birthday today", () => {
    render(<BirthdaysToday birthdays={[]} />);

    const section = screen.getByTestId("birthdays-today");
    expect(within(section).getByRole("heading", { name: "Cumpleaños de hoy" })).toBeInTheDocument();
    expect(within(section).getByText("Hoy no hay cumpleaños")).toBeInTheDocument();
    expect(within(section).queryByRole("list")).toBeNull();
    expect(within(section).queryByText(/Página \d+ de \d+/)).toBeNull();
  });
});
