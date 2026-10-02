import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import EnrollConfirmation, { type EnrollConfirmationProps } from "../EnrollConfirmation";

function renderConfirmation(overrides: Partial<EnrollConfirmationProps> = {}) {
  const props: EnrollConfirmationProps = {
    studentName: "Lucas Martinez",
    isSelf: false,
    sessionConfirmed: true,
    sessionNotice: null,
    accountAreaLink: { href: "/student", label: "Ir a mi cuenta" },
    onReset: vi.fn(),
    ...overrides,
  };
  render(<EnrollConfirmation {...props} />);
  return props;
}

describe("EnrollConfirmation", () => {
  it("shows a real, local club photo with a text alternative", () => {
    renderConfirmation();
    const photo = screen.getByRole("img", { name: /cata club entrenando en las mesas/i });
    expect(decodeURIComponent(photo.getAttribute("src") ?? "")).toContain("/landing/hero-training.jpg");
  });

  it("lays the next steps out as one ordered sequence of four", () => {
    renderConfirmation();
    expect(screen.getByRole("heading", { level: 2, name: "Qué sigue" })).toBeInTheDocument();
    const steps = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(steps).toHaveLength(4);
    ["Su cuenta", "Su correo", "El club", "Su membresía"].forEach((title, index) =>
      expect(within(steps[index]).getByRole("heading", { level: 3, name: title })).toBeInTheDocument(),
    );
    expect(steps[0]).toHaveTextContent("Su cuenta ya está creada y la sesión, iniciada.");
    expect(steps[3]).toHaveTextContent("El club lo valida y ahí se activa la membresía.");
  });

  it("puts the student's name first and the success state in the page heading", () => {
    renderConfirmation();
    expect(screen.getByRole("heading", { level: 1, name: /inscripción completada/i })).toBeInTheDocument();
    expect(screen.getByText("Lucas Martinez")).toBeInTheDocument();
    expect(screen.getByText("¡Le damos la bienvenida a Cata Club!")).toBeInTheDocument();
    expect(screen.getByText("Su camino en el tenis de mesa comienza aquí.")).toBeInTheDocument();
  });

  it("only claims the session when it was confirmed", () => {
    renderConfirmation({ sessionConfirmed: false, accountAreaLink: null });
    expect(screen.queryByText(/la sesión, iniciada/i)).not.toBeInTheDocument();
    expect(screen.getByText(/inicie sesión con su correo y su contraseña/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Iniciar sesión" })).toHaveAttribute("href", "/login");
  });

  it("shows the unconfirmed-session notice as an alert on the card, and only then", () => {
    const { unmount } = render(
      <EnrollConfirmation
        studentName="Lucas Martinez"
        isSelf={false}
        sessionConfirmed={false}
        sessionNotice="No pudimos iniciar su sesión. Inicie sesión con su correo."
        accountAreaLink={null}
        onReset={vi.fn()}
      />,
    );
    const notice = screen.getByRole("alert");
    expect(notice).toHaveTextContent("No pudimos iniciar su sesión. Inicie sesión con su correo.");
    expect(notice).toHaveAttribute("data-testid", "enroll-session-not-confirmed");
    unmount();

    renderConfirmation();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps one primary action and a secondary 'Nueva inscripción' that resets", () => {
    const props = renderConfirmation();
    expect(screen.getByRole("link", { name: "Ir a mi cuenta" })).toHaveAttribute("href", "/student");
    fireEvent.click(screen.getByRole("button", { name: "Nueva inscripción" }));
    expect(props.onReset).toHaveBeenCalledTimes(1);
  });

  it("states the role of the person enrolling", () => {
    renderConfirmation({ isSelf: true });
    expect(screen.getByText(/titular de la cuenta y el estudiante/i)).toBeInTheDocument();
  });
});
