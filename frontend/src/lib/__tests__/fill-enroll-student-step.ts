/**
 * Fills the enrolment wizard's student step with the same "Sofia Martinez"
 * data every `EnrollPage` test in this suite converges on, its health step
 * with the same emergency-contact trio, and — for the tests that carry a
 * self enrolment all the way through — the click-by-click walk from the
 * student step to the "Inscripción completada" screen.
 *
 * Issue #876 added an eighth field — "Confirmar contraseña" — to a fill
 * sequence that was already copied verbatim across every test that walks a
 * self enrolment past the student step, and across the health step's own
 * three fields. That single new line landed inside eight cloned copies at
 * once, which is what pushed the PR over SonarCloud's duplication gate.
 * `completeSelfEnrollmentWizard` exists for the same reason one level up:
 * once the student- and health-step fills collapsed to one call each, the
 * three call sites that submit and wait for the confirmation screen were
 * left as an eleven-line clone of each other.
 */

import { fireEvent, screen } from "@testing-library/react";
import { fillBirthDate } from "@/lib/__tests__/fill-birth-date";
import { enrollFieldId } from "@/app/student/enroll/enroll-utils";

export function fillEnrollStudentStep(): void {
  fireEvent.change(screen.getByLabelText(/^Nombres/), { target: { value: "Sofia" } });
  fireEvent.change(screen.getByLabelText(/^Apellidos/), { target: { value: "Martinez" } });
  fillBirthDate(enrollFieldId("fechaNacimiento"), "1990-05-20");
  fireEvent.change(screen.getByLabelText(/cédula de identidad/i), { target: { value: "1798765432" } });
  fireEvent.change(screen.getByLabelText(/^Teléfono/), { target: { value: "0991234567" } });
  fireEvent.change(screen.getByLabelText(/^Correo electrónico/), { target: { value: "sofia@example.com" } });
  fireEvent.change(screen.getByLabelText(/^Contraseña/), { target: { value: "password8" } });
  fireEvent.change(screen.getByLabelText(/^Confirmar contraseña/), { target: { value: "password8" } });
}

export function fillEnrollHealthStep(): void {
  fireEvent.change(screen.getByLabelText(/tipo de sangre/i), { target: { value: "O_POSITIVO" } });
  fireEvent.change(screen.getByLabelText(/nombre del contacto/i), { target: { value: "Ana Martinez" } });
  fireEvent.change(screen.getByLabelText(/teléfono de emergencia/i), { target: { value: "0999888777" } });
}

/**
 * Walks a self enrolment from the student step through "Confirmar
 * inscripción" and waits for the confirmation screen. Assumes the wizard is
 * already rendered and standing on the type step.
 */
export async function completeSelfEnrollmentWizard(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: /^Siguiente/ }));
  fillEnrollStudentStep();
  fireEvent.click(screen.getByRole("button", { name: /^Siguiente/ }));

  fillEnrollHealthStep();
  fireEvent.click(screen.getByRole("button", { name: /^Siguiente/ }));

  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: /confirmar inscripción/i }));

  await screen.findByText(/inscripción completada/i);
}
