/**
 * The parts of `/student/add-dependent` that a screenshot proves once and a
 * rewrite loses silently — `enroll-visual-contract.test.tsx`'s twin, written
 * for the wizard that was left behind when the public one was fixed.
 *
 * Every case here is one finding of the final batch, written against the
 * reason and not the pixel:
 *
 *  · **Two contradictory marks for the same idea, in one step.** The health
 *    step drew "Tipo de Sangre *" — the red asterisk `wizard-fields.tsx`
 *    retired, with its own note explaining why — directly above two fields
 *    marked "(opcional)" by the replacement. So the step marked the required
 *    field one way and the optional ones the other, and the visitor had to
 *    learn both to read either.
 *  · **Two vocabularies for an example, eighty pixels apart.** "p. ej." on the
 *    two textareas, "Por ejemplo:" on the two emergency fields below them.
 *    The abbreviation is the one thing "la regla de las palabras" forbids
 *    outright, and `example()` exists precisely so nobody writes it again.
 *  · **The ids came from the labels.** The two textareas passed no `field`, so
 *    `slugifyLabel` built their ids out of the visible copy; the two selects
 *    wrote by hand what that slugifier would produce, which made "Tipo de
 *    Sangre" the reason this wizard's blood-type field is called something
 *    different from the identical field on the public one.
 *  · **Raw Tailwind, under AA.** `text-blue-700/80` on the canvas reads
 *    3.84:1 and `text-amber-700/80` on the warn tint reads 3.25:1 — two
 *    colours from a palette this product does not use, both below the floor.
 *  · **The error wore the action red and its retired halo.** The same pair
 *    `WizardInput` gave up one batch earlier, kept alive on the one control
 *    this screen renders itself.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import AddDependentPage from "@/app/student/add-dependent/page";
import { installAddDependentHarness } from "./add-dependent-harness";
import {
  ADD_DEPENDENT_FIELD_TOKEN,
  addDependentFieldId,
  type AddDependentField,
} from "@/app/student/add-dependent/add-dependent-utils";
import { slugifyLabel } from "@/components/wizard-fields";
import { fillBirthDate } from "@/lib/__tests__/fill-birth-date";

// The seven-mock preamble this wizard needs before it will mount lives in
// `add-dependent-harness`; see that module for why the bodies are there and
// the `vi.mock` calls are here.
// `vi.hoisted` so the binding exists before the hoisted `vi.mock` factories run.
const harness = vi.hoisted(() => () => import("./add-dependent-harness"));

vi.mock("@/components/ProtectedRoute", async () => (await harness()).protectedRouteDouble());
vi.mock("next/navigation", async () => (await harness()).navigationDouble());
vi.mock("next/link", async () => (await harness()).nextLinkDouble());
vi.mock("next/image", async () => (await harness()).nextImageDouble());
vi.mock("@/contexts/AuthContext", async () => (await harness()).authContextDouble());
vi.mock("@/contexts/ToastContext", async () => (await harness()).toastContextDouble());

vi.mock("@/services/api", () => ({
  fetchStudentPortal: vi.fn(),
  crearRepresentado: vi.fn(),
  vincularRepresentado: vi.fn(),
  fetchInstituciones: vi.fn().mockResolvedValue([]),
}));

installAddDependentHarness();

/** Fill the identity block the first step asks for, without advancing. */
function fillChildStep(): void {
  fireEvent.change(screen.getByLabelText(/^Nombres/), { target: { value: "Mateo Andres" } });
  fireEvent.change(screen.getByLabelText(/^Apellidos/), { target: { value: "Zambrano Loor" } });
  fireEvent.change(screen.getByLabelText(/^Cédula/), { target: { value: "1798765432" } });
  fillBirthDate(addDependentFieldId("fechaNacimiento"), "2014-05-12");
  fireEvent.change(screen.getByLabelText(/^Teléfono/), { target: { value: "0991234567" } });
}

/** Walk to the credentials step (step 2) from the identity step. */
function goToCredentialsStep(): void {
  fillChildStep();
  fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));
}

/** Walk to a later step by filling the identity block the first one asks for. */
function goToHealthStep(): void {
  goToCredentialsStep();
  fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));
}

describe("the field ids are declared, not slugged from the label", () => {
  it("renders the dependent step under the ids the token table declares", () => {
    render(<AddDependentPage />);

    for (const field of ["nombres", "apellidos", "fechaNacimiento", "cedula", "telefono"] as const) {
      expect(document.getElementById(addDependentFieldId(field))).not.toBeNull();
    }
  });

  it("renders the health step's own controls under those ids too", () => {
    render(<AddDependentPage />);
    goToHealthStep();

    for (const field of [
      "tipoSangre",
      "enfermedades",
      "alergias",
      "contactoEmergencia",
      "telefonoEmergencia",
    ] as const) {
      expect(document.getElementById(addDependentFieldId(field))).not.toBeNull();
    }
  });

  /**
   * The load-bearing one. Every token has to be a token — a value that happens
   * to equal what `slugifyLabel` returns today is still an id that moves when
   * the copy does, and three of these used to be exactly that.
   */
  it("names the blood-type field after the field, not after the label", () => {
    expect(ADD_DEPENDENT_FIELD_TOKEN.tipoSangre).toBe("tipo-sangre");
    expect(ADD_DEPENDENT_FIELD_TOKEN.tipoSangre).not.toBe(slugifyLabel("Tipo de Sangre"));
  });

  it("gives no two fields the same id", () => {
    const tokens = Object.values(ADD_DEPENDENT_FIELD_TOKEN);
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it("declares an id for every field the payload carries", () => {
    const declared = Object.keys(ADD_DEPENDENT_FIELD_TOKEN) as AddDependentField[];
    expect(declared).toContain("institucionId");
    expect(declared.length).toBeGreaterThanOrEqual(13);
  });
});

describe("one mark for one idea", () => {
  it("marks the optional fields and marks the required blood type", () => {
    render(<AddDependentPage />);
    goToHealthStep();

    const bloodLabel = document.querySelector(
      `label[for="${addDependentFieldId("tipoSangre")}"]`,
    ) as HTMLElement;
    expect(bloodLabel.textContent).toContain("*");
    // The two textareas beside it are genuinely optional and say the word.
    const diseasesLabel = document.querySelector(
      `label[for="${addDependentFieldId("enfermedades")}"]`,
    ) as HTMLElement;
    expect(diseasesLabel.textContent).toContain("(opcional)");
  });

  /**
   * `correo` and `contrasenia` hardcoded "(opcional)" into their own label
   * text on top of the one `WizardInput` already appends for every
   * non-required field, so the step read "(opcional)(opcional)" — the same
   * mark said twice this describe block is about, just on a different step.
   */
  it("marks the credentials step's optional fields exactly once", () => {
    render(<AddDependentPage />);
    goToCredentialsStep();

    const correoInput = screen.getByLabelText(/^Correo electrónico/);
    const contraseniaInput = screen.getByLabelText(/^Contraseña/);
    const correoLabel = document.querySelector(`label[for="${correoInput.id}"]`) as HTMLElement;
    const contraseniaLabel = document.querySelector(
      `label[for="${contraseniaInput.id}"]`,
    ) as HTMLElement;

    expect(correoLabel.textContent?.match(/\(opcional\)/g)).toHaveLength(1);
    expect(contraseniaLabel.textContent?.match(/\(opcional\)/g)).toHaveLength(1);
  });

  it("requires both child credentials as soon as either one is entered", () => {
    render(<AddDependentPage />);
    goToCredentialsStep();
    const correo = screen.getByLabelText(/^Correo electrónico/);
    const contrasenia = screen.getByLabelText(/^Contraseña/);
    expect(correo).not.toBeRequired();
    expect(contrasenia).not.toBeRequired();
    fireEvent.change(correo, { target: { value: "menor@ejemplo.com" } });
    expect(correo).toBeRequired();
    expect(contrasenia).toBeRequired();
  });

  it("keeps the action colour off the one control this screen renders itself", () => {
    render(<AddDependentPage />);
    goToHealthStep();

    const select = document.getElementById(addDependentFieldId("tipoSangre")) as HTMLElement;
    fireEvent.blur(select);

    expect(select.className).not.toMatch(/(?:^|\s)border-cata-red\b/);
    expect(select.className).not.toMatch(/\bring-/);
    expect(select.className).toMatch(/\bborder-state-bad\b/);
  });
});

describe("one vocabulary for an example", () => {
  it("never abbreviates 'por ejemplo' in a placeholder", () => {
    render(<AddDependentPage />);
    goToHealthStep();

    for (const input of Array.from(document.querySelectorAll("input, textarea"))) {
      expect(input.getAttribute("placeholder") ?? "").not.toMatch(/p\.\s*ej\./i);
    }
    expect(
      document.getElementById(addDependentFieldId("enfermedades"))?.getAttribute("placeholder"),
    ).toMatch(/^Por ejemplo: /);
  });
});

describe("the colours come from the system's own ramps", () => {
  it("paints its two advisory boxes with tokens, not with Tailwind's palette", () => {
    const { container } = render(<AddDependentPage />);
    goToHealthStep();

    // 3.84:1 and 3.25:1 respectively, both under AA, both from a palette this
    // product does not paint with.
    expect(container.innerHTML).not.toMatch(/text-blue-\d/);
    expect(container.innerHTML).not.toMatch(/text-amber-\d/);
  });

  /**
   * Scoped to the WIZARD's own form, not to the whole render.
   *
   * `AppShell` is rendered for real here and its header chrome still carries
   * the 12px radius — eleven of them in `components/Header.tsx`. That is a
   * foundation file from F1 and a different batch's work; asserting over the
   * whole tree would make this case fail for a reason it is not about, and
   * "fix the shell" is not a thing a screen test may ask for.
   */
  it("keeps the wizard on the system's two radii", () => {
    const { container } = render(<AddDependentPage />);
    goToHealthStep();

    const form = container.querySelector("form") as HTMLElement;
    expect(form.querySelectorAll(".rounded-xl")).toHaveLength(0);
  });
});

describe("the card title is in the club's face", () => {
  /**
   * It was `text-sm font-bold` — the DENSE step, 13.5px, SMALLER than the
   * 14px labels of the fields inside the card it names. `display-face-usage`
   * cannot see that: its rule fires on a heading already at the title step,
   * so a title one step below the floor passes by being too small.
   */
  it("puts the step's title at the title step in Graduate", () => {
    render(<AddDependentPage />);

    const heading = screen.getByRole("heading", { name: /datos del dependiente/i });
    expect(heading.className).toMatch(/\bfont-display\b/);
    expect(heading.className).toMatch(/\btext-lg\b/);
    expect(heading.className).toMatch(/\btracking-flat\b/);
    // Graduate has one 400 cut; a weight class asks the browser to synthesise
    // a bold on a face that cannot draw one.
    expect(heading.className).not.toMatch(/\bfont-(?:bold|semibold|extrabold)\b/);
  });
});

describe("the kicker clears AA on the surface it actually lands on", () => {
  /**
   * `ink-3` is not the defect and darkening it is not the fix. The token
   * measures 4.62:1 on `paper` and passes; it slips to 3.78:1 only once the
   * page `canvas` is underneath, which is where this kicker sits. That is the
   * case `tailwind.config.ts` declares `ink-3-strong` for, in as many words —
   * "the page kicker, the page subtitle, the table header" — and the public
   * enrolment wizard already writes the same string that way.
   *
   * A class-level assertion can only make this claim because the surface is
   * fixed by construction: the kicker is a page-level element, never inside a
   * card. Where the surface depends on ancestors, only a rendered check knows.
   */
  it("puts the canvas kicker on the AA-safe step of the ramp", () => {
    render(<AddDependentPage />);

    const kicker = screen.getByText(/^Paso 1 de \d+$/);
    expect(kicker).toHaveClass("text-ink-3-strong");
    // `\btext-ink-3\b` would match INSIDE `text-ink-3-strong` — a hyphen is a
    // word boundary — so the guard has to exclude the longer token by hand.
    expect(kicker.className).not.toMatch(/\btext-ink-3(?![\w-])/);
  });
});
