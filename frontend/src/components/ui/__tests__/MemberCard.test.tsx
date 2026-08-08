/**
 * MemberCard — the membership carnet for the profile screen. The app's
 * student carnet already establishes the coal/ball language; this retakes
 * it rather than inventing a second one, but reads as an object (a carnet),
 * not as a page header.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import MemberCard from "@/components/ui/MemberCard";

function renderCard() {
  return render(
    <MemberCard
      name="Laura Vera"
      email="laura@example.com"
      role="Administradora"
      memberSince="Socia desde ene 2023"
    />,
  );
}

describe("MemberCard — identity reads as an object", () => {
  it("labels the whole card by the member's name", () => {
    renderCard();
    expect(screen.getByRole("region", { name: /laura vera/i })).toBeInTheDocument();
  });

  it("renders the name in a mono weight distinct from body text", () => {
    renderCard();
    expect(screen.getByText("Laura Vera")).toHaveClass("font-mono", "truncate");
  });

  // The card was calibrated against "Laura Vera" (10 chars) and never tried
  // against a real long name in a compact card — `text-display` (46px) is
  // sized for the auth headline, not for a carnet that shares its row with a
  // 72px avatar. At that size "Jefferson Delgado Rivadeneira" (29 chars)
  // would only leave a handful of characters visible before `truncate`
  // clips it. `text-lg` is the scale's own "a name that leads a row" step
  // (see tailwind.config.ts's fontSize.lg) — the one built for exactly this.
  it("uses a size calibrated for a real long name in a compact card, not the 46px auth headline", () => {
    render(
      <MemberCard
        name="Jefferson Delgado Rivadeneira"
        email="jefferson@example.com"
        role="Alumno"
        memberSince="Socio desde mar 2024"
      />,
    );
    const name = screen.getByText("Jefferson Delgado Rivadeneira");
    expect(name).toHaveClass("text-lg");
    expect(name).not.toHaveClass("text-display");
    // truncate still guards whatever the viewport cannot fit.
    expect(name).toHaveClass("truncate");
  });

  it("renders the email in a muted tone under the name", () => {
    renderCard();
    expect(screen.getByText("laura@example.com")).toHaveClass("text-white/60");
  });
});

describe("MemberCard — surface", () => {
  it("sits on the coal surface, the club's carnet treatment", () => {
    renderCard();
    expect(screen.getByRole("region")).toHaveClass("bg-coal");
  });

  it("carries the yellow ball as its accent dot", () => {
    renderCard();
    const dot = screen.getByRole("region").querySelector("span[aria-hidden='true'].bg-ball");
    expect(dot).not.toBeNull();
  });
});

describe("MemberCard — footer", () => {
  it("shows the role and the member-since fact, separated from the identity by a line", () => {
    renderCard();
    expect(screen.getByText("Administradora")).toBeInTheDocument();
    expect(screen.getByText("Socia desde ene 2023")).toBeInTheDocument();
  });

  it("draws the footer's own separator rather than reusing the card's outer border", () => {
    renderCard();
    const role = screen.getByText("Administradora");
    const footer = role.closest("div") as HTMLElement;
    expect(footer).toHaveClass("border-t");
  });
});
