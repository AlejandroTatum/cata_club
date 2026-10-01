import { render, screen } from "@testing-library/react";
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
