/**
 * Component tests for WizardNavigation's error alert.
 *
 * The case that matters: the backend answers a repeated cédula with a plain
 * sentence and, until now, the wizards printed it and stopped there — no way
 * to sign in, recover a password, or find the existing person. The alert must
 * offer a real destination, and it must offer the RIGHT one for whoever hit
 * the wall (a prospective family, a guardian, an admin).
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { WizardNavigation } from "@/components/wizard-fields";

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const DUPLICADA = "Ya existe una persona con la cédula 1712345678";

function renderNav(props: Partial<React.ComponentProps<typeof WizardNavigation>> = {}) {
  return render(
    <WizardNavigation
      formErrors={[]}
      isFirst={false}
      isLast
      submitting={false}
      onBack={vi.fn()}
      onNext={vi.fn()}
      submitButton={<button type="submit">Confirmar</button>}
      {...props}
    />,
  );
}

describe("WizardNavigation — already-registered escape hatch", () => {
  it("offers sign-in and password recovery to a public self-enrolment", () => {
    renderNav({ formErrors: [DUPLICADA], duplicateIdentityAudience: "self-service" });

    const alert = screen.getByRole("alert");
    expect(within(alert).getByText(DUPLICADA)).toBeInTheDocument();
    expect(within(alert).getByRole("link", { name: /iniciar sesión/i })).toHaveAttribute("href", "/login");
    expect(within(alert).getByRole("link", { name: /recuperar contraseña/i })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
  });

  it("sends a guardian to their dependents instead of a login page", () => {
    renderNav({ formErrors: [DUPLICADA], duplicateIdentityAudience: "representative" });

    const alert = screen.getByRole("alert");
    expect(within(alert).getByRole("link", { name: /ver mis dependientes/i })).toHaveAttribute("href", "/student");
    expect(within(alert).queryByRole("link", { name: /iniciar sesión/i })).not.toBeInTheDocument();
  });

  it("sends an admin to the members list instead of a login page", () => {
    renderNav({ formErrors: [DUPLICADA], duplicateIdentityAudience: "admin" });

    const alert = screen.getByRole("alert");
    expect(within(alert).getByRole("link", { name: /ir a miembros/i })).toHaveAttribute("href", "/members");
    expect(within(alert).queryByRole("link", { name: /iniciar sesión/i })).not.toBeInTheDocument();
  });

  it("also recognises a duplicate e-mail, not just a duplicate cédula", () => {
    renderNav({
      formErrors: ["El correo ya está en uso por otra cuenta"],
      duplicateIdentityAudience: "self-service",
    });

    expect(within(screen.getByRole("alert")).getByRole("link", { name: /iniciar sesión/i })).toBeInTheDocument();
  });

  it("stays out of the way for an ordinary validation error", () => {
    renderNav({
      formErrors: ["La cédula debe tener 10 dígitos."],
      duplicateIdentityAudience: "self-service",
    });

    const alert = screen.getByRole("alert");
    expect(within(alert).queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders no alert at all when there is nothing wrong", () => {
    renderNav({ duplicateIdentityAudience: "self-service" });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("never leaks details about the existing account", () => {
    renderNav({ formErrors: [DUPLICADA], duplicateIdentityAudience: "self-service" });

    // Only what the backend already said: the cédula the user typed. No
    // e-mail, no name, no account status.
    expect(screen.getByRole("alert").textContent ?? "").not.toMatch(/@/);
  });
});

// --- INS-2 (docs/product/decisiones-de-negocio-2026-08-11.md §1): "Vincular a mi
// cuenta" action next to the alert. Same-click as the escape hatch above —
// no extra page, no extra step beyond the one that already reveals the
// duplicate-identity error. ---------------------------------------------
describe("WizardNavigation — vincular a mi cuenta (INS-2)", () => {
  it("stays hidden when the caller does not pass onLinkExisting, even for a representative", () => {
    renderNav({ formErrors: [DUPLICADA], duplicateIdentityAudience: "representative" });

    expect(screen.queryByRole("button", { name: /vincular a mi cuenta/i })).not.toBeInTheDocument();
  });

  it("renders next to the alert when onLinkExisting is provided", () => {
    renderNav({
      formErrors: [DUPLICADA],
      duplicateIdentityAudience: "representative",
      onLinkExisting: vi.fn(),
    });

    const alert = screen.getByRole("alert");
    expect(within(alert).getByRole("button", { name: /vincular a mi cuenta/i })).toBeInTheDocument();
  });

  it("calls onLinkExisting when clicked", () => {
    const onLinkExisting = vi.fn();
    renderNav({
      formErrors: [DUPLICADA],
      duplicateIdentityAudience: "representative",
      onLinkExisting,
    });

    fireEvent.click(screen.getByRole("button", { name: /vincular a mi cuenta/i }));
    expect(onLinkExisting).toHaveBeenCalledTimes(1);
  });

  it("disables itself and swaps its label while linkingExisting is true", () => {
    renderNav({
      formErrors: [DUPLICADA],
      duplicateIdentityAudience: "representative",
      onLinkExisting: vi.fn(),
      linkingExisting: true,
    });

    const button = screen.getByRole("button", { name: /vinculando/i });
    expect(button).toBeDisabled();
  });

  it("does not render for an audience that cannot link (self-service)", () => {
    renderNav({
      formErrors: [DUPLICADA],
      duplicateIdentityAudience: "self-service",
      onLinkExisting: vi.fn(),
    });

    expect(screen.queryByRole("button", { name: /vincular a mi cuenta/i })).not.toBeInTheDocument();
  });
});
