/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import SponsorsStripPreview from "../SponsorsStripPreview";

const sponsor = (id: number, nombre: string) => ({
  id,
  nombre,
  logoUrl: `https://cdn/${id}.png`,
});

describe("SponsorsStripPreview", () => {
  it("renders the sponsors in order with the name as alt text on 5:2 contain tiles", () => {
    render(
      <SponsorsStripPreview
        sponsors={[
          sponsor(2, "Municipio"),
          sponsor(1, "Cervecería"),
          sponsor(3, "Radio"),
        ]}
      />,
    );
    const images = screen.getAllByRole("img");
    expect(images.map((img) => img.getAttribute("alt"))).toEqual([
      "Municipio",
      "Cervecería",
      "Radio",
    ]);
    expect(images[0]).toHaveAttribute("src", "https://cdn/2.png");
    expect(images[0]).toHaveClass("object-contain");
    expect(images[0].parentElement?.style.aspectRatio).toBe("5 / 2");
  });

  it("shows ghost tiles and a one-line note when there are no sponsors", () => {
    render(<SponsorsStripPreview sponsors={[]} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(
      screen.getAllByTestId("sponsors-strip-ghost").length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/Cuando suba el primer logo/)).toBeInTheDocument();
  });
});
