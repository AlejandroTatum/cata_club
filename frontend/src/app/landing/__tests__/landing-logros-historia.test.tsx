/** @vitest-environment jsdom */

/**
 * Structural lock for the Logros redesign (approved prototype
 * `landing-logros-d-historia.html`, issue #657's follow-up). Replaces the
 * five-row placeholder trophy wall, its default-off demo toggle and its
 * "pedido al club" box with one documented result told as a short story: a
 * feature photo, a fact sheet, and a secondary row of four podium photos.
 *
 * `LOGRO_DESTACADO.year` and `.result` are empty in the shipped data — the
 * club has not supplied either — so the "Año"/"Resultado" facts must not
 * render by default; the second describe block proves they DO render once
 * the club supplies both, by mocking the data module fresh per test (same
 * dynamic-import + `vi.resetModules()` convention used whenever a test needs
 * a different module graph than its neighbours).
 */

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/image", (): { __esModule: boolean; default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => React.ReactElement } => ({
  __esModule: true,
  default: ({ alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>): React.ReactElement => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt ?? ""} {...props} />
  ),
}));

afterEach((): void => {
  cleanup();
  vi.resetModules();
});

describe("Logros (Sudamericano feature)", (): void => {
  it("renders the four documented facts, with no Año or Resultado on file", async (): Promise<void> => {
    const { default: Palmares } = await import("@/app/landing/Palmares");
    render(<Palmares />);

    const section = document.querySelector("#logros") as HTMLElement;
    expect(within(section).getByText("Competencia")).toBeInTheDocument();
    expect(within(section).getByText("Sudamericano Sub-11 y Sub-13")).toBeInTheDocument();
    expect(within(section).getByText("Sede")).toBeInTheDocument();
    expect(within(section).getByText("Asunción, Paraguay")).toBeInTheDocument();
    expect(within(section).getByText("Representación")).toBeInTheDocument();
    expect(within(section).getByText("Categorías")).toBeInTheDocument();
    // "Selección de Ecuador" (kicker) and "Sub-11 y Sub-13" (headline) each
    // also appear elsewhere, so their facts are asserted by their own dt/dd
    // pair instead of a bare text match.
    const representationFact = within(section).getByText("Representación").closest(".landing-logro-fact");
    expect(representationFact).toHaveTextContent("Selección de Ecuador");
    const categoriesFact = within(section).getByText("Categorías").closest(".landing-logro-fact");
    expect(categoriesFact).toHaveTextContent("Sub-11 y Sub-13");

    expect(within(section).queryByText("Año")).not.toBeInTheDocument();
    expect(within(section).queryByText("Resultado")).not.toBeInTheDocument();
  });

  it("renders the verbatim story paragraph", async (): Promise<void> => {
    const { default: Palmares } = await import("@/app/landing/Palmares");
    render(<Palmares />);

    expect(
      screen.getByText(
        "Deportistas del club vistieron la camiseta de Ecuador en el Sudamericano Sub-11 y Sub-13 disputado en Asunción, Paraguay. Representar al país en una competencia continental es el logro más alto del club hasta hoy.",
      ),
    ).toBeInTheDocument();
  });

  it("has no demo toggle checkbox inside #logros", async (): Promise<void> => {
    const { default: Palmares } = await import("@/app/landing/Palmares");
    render(<Palmares />);

    const section = document.querySelector("#logros") as HTMLElement;
    expect(within(section).queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("never renders fabricated example data", async (): Promise<void> => {
    const { default: Palmares } = await import("@/app/landing/Palmares");
    const { container } = render(<Palmares />);

    expect(container).not.toHaveTextContent(/ejemplo/i);
    expect(container).not.toHaveTextContent("2024");
    expect(container).not.toHaveTextContent("Medalla de bronce por equipos");
  });

  it("renders exactly 5 images, the first being the Sudamericano photo", async (): Promise<void> => {
    const { default: Palmares } = await import("@/app/landing/Palmares");
    const { container } = render(<Palmares />);

    const images = Array.from(container.querySelectorAll("img"));
    expect(images).toHaveLength(5);
    expect(images[0]).toHaveAttribute("src", "/landing/photo-southamerican.jpeg");
  });

  it("lays the section out as header, feature, then the podios block, in that order", async (): Promise<void> => {
    const { default: Palmares } = await import("@/app/landing/Palmares");
    const { container } = render(<Palmares />);

    const section = container.querySelector("#logros") as HTMLElement;
    const children = Array.from(section.children);
    expect(children.map((child): string => child.className)).toEqual([
      "landing-section-header",
      "landing-logro",
      "landing-podios-block",
    ]);
  });

  it("keeps the feature index decorative and gives the podios their own 02-05 indices", async (): Promise<void> => {
    const { default: Palmares } = await import("@/app/landing/Palmares");
    const { container } = render(<Palmares />);

    const featureIndex = container.querySelector(".landing-logro-index");
    expect(featureIndex).toHaveAttribute("aria-hidden", "true");
    expect(featureIndex).toHaveTextContent("01");

    const podiumItems = Array.from(container.querySelectorAll(".landing-podios > li"));
    expect(podiumItems).toHaveLength(4);
    podiumItems.forEach((item, index): void => {
      const badge = item.querySelector(".landing-podios-index");
      expect(badge).toHaveAttribute("aria-hidden", "true");
      expect(badge).toHaveTextContent(String(index + 2).padStart(2, "0"));
    });
  });

  it("labels the section eyebrow 'Nuestra vitrina' with no subtitle sentence", async (): Promise<void> => {
    const { default: Palmares } = await import("@/app/landing/Palmares");
    const { container } = render(<Palmares />);

    expect(screen.getByText("Nuestra vitrina")).toBeInTheDocument();
    const header = container.querySelector(".landing-section-header") as HTMLElement;
    expect(header.querySelector("p")).toBeNull();
  });
});

describe("Logros (once the club supplies Año and Resultado)", (): void => {
  it("renders both facts, in addition to the four already documented", async (): Promise<void> => {
    vi.doMock("@/app/landing/landing-logros", async (importOriginal): Promise<typeof import("@/app/landing/landing-logros")> => {
      const actual = await importOriginal<typeof import("@/app/landing/landing-logros")>();
      return {
        ...actual,
        LOGRO_DESTACADO: { ...actual.LOGRO_DESTACADO, year: "2024", result: "Medalla de bronce por equipos" },
      };
    });

    const { default: Palmares } = await import("@/app/landing/Palmares");
    render(<Palmares />);

    const section = document.querySelector("#logros") as HTMLElement;
    expect(within(section).getByText("Año")).toBeInTheDocument();
    expect(within(section).getByText("2024")).toBeInTheDocument();
    expect(within(section).getByText("Resultado")).toBeInTheDocument();
    expect(within(section).getByText("Medalla de bronce por equipos")).toBeInTheDocument();
    // The four always-documented facts stay put — the optional facts are
    // additive, never a replacement.
    expect(within(section).getByText("Competencia")).toBeInTheDocument();
  });
});
