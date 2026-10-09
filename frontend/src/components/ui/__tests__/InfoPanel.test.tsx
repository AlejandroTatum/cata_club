import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { InfoPanel } from "@/components/ui";

describe("InfoPanel", () => {
  it("is a labelled complementary region with its title and content", () => {
    render(
      <InfoPanel title="Resumen">
        <p>Cuatro descuentos activos</p>
      </InfoPanel>,
    );

    const panel = screen.getByRole("complementary", { name: "Resumen" });
    expect(panel).toHaveTextContent("Cuatro descuentos activos");
    expect(screen.getByRole("heading", { level: 2, name: "Resumen" })).toBeInTheDocument();
  });
});

describe("InfoPanel as a div", () => {
  it("does not add a second landmark inside an existing aside", () => {
    render(
      <InfoPanel as="div" title="Detalle">
        <p>Texto</p>
      </InfoPanel>,
    );

    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Detalle" })).toBeInTheDocument();
  });
});

describe("InfoPanel is quiet help, not a second data card (T14 RC3)", () => {
  it("drops the sticker outline and shadow for a flat surface", () => {
    render(
      <InfoPanel title="Cómo funciona">
        <p>Texto</p>
      </InfoPanel>,
    );
    const panel = screen.getByRole("complementary", { name: "Cómo funciona" });
    expect(panel.className).not.toMatch(/(^|\s)card(\s|$)/);
    expect(panel.className).not.toMatch(/shadow/);
    expect(panel.className).toMatch(/bg-paper/);
    expect(panel.className).toMatch(/border-line/);
    expect(screen.getByRole("heading", { name: "Cómo funciona" }).className).toMatch(/text-base/);
  });

  it("is collapsed below lg behind a named disclosure, and the toggle opens it", () => {
    render(
      <InfoPanel title="Cómo funciona">
        <p>Texto de ayuda</p>
      </InfoPanel>,
    );
    const toggle = screen.getByRole("button", { name: "Mostrar Cómo funciona" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    const body = screen.getByText("Texto de ayuda").parentElement!;
    // Hidden below lg, always shown from lg: no state is needed on a desktop.
    expect(body.className).toMatch(/max-lg:hidden/);
    expect(body.className).toMatch(/lg:flex/);

    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Ocultar Cómo funciona" })).toHaveAttribute("aria-expanded", "true");
    expect(body.className).not.toMatch(/max-lg:hidden/);
  });

  it("the toggle is not rendered from lg up", () => {
    render(
      <InfoPanel title="Ayuda">
        <p>Texto</p>
      </InfoPanel>,
    );
    expect(screen.getByRole("button", { name: "Mostrar Ayuda" }).className).toMatch(/lg:hidden/);
  });

  it("stays open with no toggle when it holds data rather than help", () => {
    render(
      <InfoPanel title="Pagos por revisar" collapsible={false}>
        <p>3 pendientes</p>
      </InfoPanel>,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("3 pendientes").parentElement?.className).not.toMatch(/max-lg:hidden/);
  });
});
