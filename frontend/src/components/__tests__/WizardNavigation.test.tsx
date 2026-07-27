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
import { render, screen, within } from "@testing-library/react";
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
