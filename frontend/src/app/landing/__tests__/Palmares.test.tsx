/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_PALMARES, PALMARES } from "@/app/landing/landing-palmares";
import Palmares from "@/app/landing/Palmares";

vi.mock("next/image", (): { __esModule: boolean; default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => React.ReactElement } => ({
  __esModule: true,
  default: ({ alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>): React.ReactElement => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt ?? ""} {...props} />
  ),
}));

/** Event names that exist ONLY in the fabricated demo set — never in the real one. */
const DEMO_ONLY_EVENTS = DEMO_PALMARES.map((row): string => row.event).filter(
  (event): boolean => !PALMARES.some((real): boolean => real.event === event),
);

describe("Palmares", (): void => {
  afterEach((): void => {
    cleanup();
  });

  it("renders the real, mostly-empty palmarés on first render, with the demo toggle off", (): void => {
    render(<Palmares />);

    const toggle = screen.getByRole("checkbox", { name: /datos de ejemplo/i });
    expect(toggle).not.toBeChecked();

    expect(screen.getByText("Sudamericano Sub-11 y Sub-13")).toBeInTheDocument();
    DEMO_ONLY_EVENTS.forEach((event): void => {
      expect(screen.queryByText(event)).not.toBeInTheDocument();
    });
  });

  it("shows no demo warning on first render", (): void => {
    render(<Palmares />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("switches to the fabricated data and shows a real, visible warning when the demo toggle is switched on", (): void => {
    render(<Palmares />);
    const toggle = screen.getByRole("checkbox", { name: /datos de ejemplo/i });

    fireEvent.click(toggle);

    expect(toggle).toBeChecked();
    DEMO_ONLY_EVENTS.forEach((event): void => {
      expect(screen.getByText(event)).toBeInTheDocument();
    });

    const warning = screen.getByRole("alert");
    expect(warning).toHaveTextContent(/datos de ejemplo/i);
    expect(warning).toHaveTextContent(/el club no ganó esto/i);
  });

  it("hides the warning and restores the real data when the demo toggle is switched back off", (): void => {
    render(<Palmares />);
    const toggle = screen.getByRole("checkbox", { name: /datos de ejemplo/i });

    fireEvent.click(toggle);
    expect(screen.getByRole("alert")).toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).not.toBeChecked();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Sudamericano Sub-11 y Sub-13")).toBeInTheDocument();
    DEMO_ONLY_EVENTS.forEach((event): void => {
      expect(screen.queryByText(event)).not.toBeInTheDocument();
    });
  });

  it("gives every incomplete real row the pending treatment, and no complete demo row that treatment", (): void => {
    const { container } = render(<Palmares />);

    const realRows = Array.from(container.querySelectorAll(".landing-palmares-row"));
    expect(realRows).toHaveLength(PALMARES.length);
    realRows.forEach((row): void => {
      expect(row.className).toContain("pending");
    });

    fireEvent.click(screen.getByRole("checkbox", { name: /datos de ejemplo/i }));

    const demoRows = Array.from(container.querySelectorAll(".landing-palmares-row"));
    expect(demoRows).toHaveLength(DEMO_PALMARES.length);
    demoRows.forEach((row): void => {
      expect(row.className).not.toContain("pending");
    });
  });

  it("renders the documented Sudamericano row's event and venue, with its year and medal left as placeholders", (): void => {
    render(<Palmares />);

    const row = screen.getByText("Sudamericano Sub-11 y Sub-13").closest(".landing-palmares-row");
    expect(row).not.toBeNull();
    expect(row).toHaveTextContent("Asunción, Paraguay · con el uniforme de Ecuador");
    expect(within(row as HTMLElement).getByText("año")).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText("medalla")).toBeInTheDocument();
  });

  it("lays each row out as the trophy wall record: photo, then body with year and venue, then the medal", (): void => {
    render(<Palmares />);

    const row = screen.getByText("Sudamericano Sub-11 y Sub-13").closest(".landing-palmares-row") as HTMLElement;
    const [photo, body, medal] = Array.from(row.children);
    expect(photo.className).toContain("landing-palmares-photo");
    expect(body.className).toContain("landing-palmares-body");
    expect(body.querySelector(".landing-palmares-year")).not.toBeNull();
    expect(body.querySelector(".landing-palmares-venue")).not.toBeNull();
    expect(medal.className).toContain("landing-medal");
  });

  it("keeps the demo toggle inside the Logros section itself, not a page-wide bar", (): void => {
    render(<Palmares />);

    const section = document.querySelector("#logros");
    expect(section).not.toBeNull();
    expect(within(section as HTMLElement).getByRole("checkbox", { name: /datos de ejemplo/i })).toBeInTheDocument();
  });
});
