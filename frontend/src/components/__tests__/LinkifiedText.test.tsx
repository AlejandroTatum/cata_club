/**
 * @vitest-environment jsdom
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import LinkifiedText from "@/components/LinkifiedText";

describe("LinkifiedText", () => {
  it("labels a wa.me address «WhatsApp» and keeps the full URL as href (FAM-21)", () => {
    const { container } = render(
      <p>
        <LinkifiedText text="Escríbenos por WhatsApp y te ayudamos: https://wa.me/593994219619" />
      </p>,
    );
    const link = screen.getByRole("link", { name: "WhatsApp" });
    expect(link).toHaveAttribute("href", "https://wa.me/593994219619");
    expect(container.textContent).not.toContain("wa.me");
  });

  it("keeps the sentence punctuation outside the link", () => {
    const { container } = render(
      <p>
        <LinkifiedText text="Escríbenos: https://wa.me/593994219619." />
      </p>,
    );
    expect(screen.getByRole("link", { name: "WhatsApp" })).toHaveAttribute(
      "href",
      "https://wa.me/593994219619",
    );
    expect(container.textContent).toBe("Escríbenos: WhatsApp.");
  });

  it("leaves other addresses showing their own text", () => {
    render(
      <p>
        <LinkifiedText text="Vea https://example.com/ayuda" />
      </p>,
    );
    expect(screen.getByRole("link", { name: "https://example.com/ayuda" })).toBeInTheDocument();
  });
});
