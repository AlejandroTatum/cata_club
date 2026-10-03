import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DuplicateIdentityHelp } from "@/components/DuplicateIdentityHelp";
import { WHATSAPP_CONTACTO } from "@/lib/error-message";

describe("DuplicateIdentityHelp", () => {
  it("offers the club WhatsApp as a real link to self-service enrollees", () => {
    render(<DuplicateIdentityHelp audience="self-service" />);
    const link = screen.getByRole("link", { name: "WhatsApp" });
    expect(link).toHaveAttribute("href", WHATSAPP_CONTACTO);
  });

  it("never prints the raw wa.me address (REG-09)", () => {
    const { container } = render(<DuplicateIdentityHelp audience="self-service" />);
    expect(container.textContent).not.toContain("wa.me");
    expect(container.textContent).toContain("escríbanos por WhatsApp para reactivar su cuenta.");
  });

  it("does not add the WhatsApp link for the other audiences", () => {
    render(<DuplicateIdentityHelp audience="admin" />);
    expect(screen.queryByRole("link", { name: "WhatsApp" })).toBeNull();
  });
});
