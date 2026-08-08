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

  it("renders the name in the display mono, not body text", () => {
    renderCard();
    expect(screen.getByText("Laura Vera")).toHaveClass("font-mono", "text-display");
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
