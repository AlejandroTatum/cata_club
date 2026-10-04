import { describe, it, expect } from "vitest";
import {
  buildEnrollmentRequest,
  ENROLL_FIELD_TOKEN,
  ENROLLMENT_TYPES,
  enrollmentTypeFromParam,
  fieldsForStep,
  initialFormData,
  institutionOptionLabel,
  planOptionLabel,
  shouldFocusStepHeadingOnJump,
  validateEnrollFields,
  validateEnrollStep,
  type EnrollFieldErrors,
  type EnrollFormData,
} from "../enroll-utils";

// ---------------------------------------------------------------------------
// Issue #1028, unified across every phone field by #1296 — the public
// self-service enrollment's phone shows 🇪🇨 + a fixed `+593`, and the
// editable value is ONLY the local digits that follow. It now shares
// `phoneFieldRule` (`@/lib/identity-validation`) with every other phone
// field: a `593`/`+593`/leading-0 shape is CLEANED to the same digits by the
// field itself (`PhoneField`, see `wizard-fields.test.tsx`), never rejected
// here, and the wider mobile-or-landline rule applies — the mobile-only
// restriction this flow used to carry is retired.
// ---------------------------------------------------------------------------
describe("telefono — step 2 validates the local digits after +593 (#1296)", (): void => {
  it("accepts nine mobile digits or eight fijo digits, with or without typing separators", (): void => {
    expect(
      validateEnrollFields("personal", {
        ...initialFormData,
        nombres: "Juan",
        apellidos: "Pérez",
        fechaNacimiento: "2000-01-15",
        cedula: "1798765432",
        telefono: "991234567",
        correo: "juan@example.com",
        contrasenia: "password8",
        contraseniaConfirmacion: "password8",
      }).telefono,
    ).toBeUndefined();
  });

  it("requires a value", (): void => {
    const errors = validateEnrollFields("personal", {
      ...initialFormData,
      nombres: "Juan",
      apellidos: "Pérez",
      fechaNacimiento: "2000-01-15",
      cedula: "1798765432",
      telefono: "",
      correo: "juan@example.com",
      contrasenia: "password8",
      contraseniaConfirmacion: "password8",
    });
    expect(errors.telefono).toBe("El teléfono es obligatorio.");
  });

  it("rejects a length that fits neither a celular nor a fijo, quoting the shared phoneRule message", (): void => {
    const errors = validateEnrollFields("personal", {
      ...initialFormData,
      nombres: "Juan",
      apellidos: "Pérez",
      fechaNacimiento: "2000-01-15",
      cedula: "1798765432",
      telefono: "9912",
      correo: "juan@example.com",
      contrasenia: "password8",
      contraseniaConfirmacion: "password8",
    });
    expect(errors.telefono).toMatch(
      /^El teléfono no es válido\. Escrib[ae] 9 dígitos si es celular \(por ejemplo, 991234567\) u 8 si es fijo, sin el 0 inicial\.$/,
    );
  });

  it("canonicalizes to the local 0XXXXXXXX wire form in the built enrollment request", (): void => {
    const request = buildEnrollmentRequest({
      ...initialFormData,
      nombres: "Juan",
      apellidos: "Pérez",
      fechaNacimiento: "2000-01-15",
      cedula: "1798765432",
      telefono: "991234567",
      correo: "juan@example.com",
      contrasenia: "password8",
      tipoSangre: "O_POSITIVO",
      contactoEmergencia: "María",
      telefonoEmergencia: "987654321",
    });
    expect(request.alumno.telefono).toBe("0991234567");
  });
});

// ---------------------------------------------------------------------------
// Issue #1138 — a represented child has no emergency contact of their own:
// it is derived from the representante, never a field this wizard collects.
// ---------------------------------------------------------------------------
describe("health step — emergency contact only exists on the self (adult) path", (): void => {
  it("does not render contactoEmergencia/telefonoEmergencia for a child enrollment", (): void => {
    expect(fieldsForStep("health", ENROLLMENT_TYPES.CHILD)).toEqual(["tipoSangre"]);
  });

  it("still requires both for a self (adult) enrollment", (): void => {
    expect(fieldsForStep("health", ENROLLMENT_TYPES.SELF)).toEqual([
      "tipoSangre",
      "contactoEmergencia",
      "telefonoEmergencia",
    ]);
  });

  it("a child enrollment's health step is valid with only tipoSangre filled", (): void => {
    const data: EnrollFormData = {
      ...initialFormData,
      enrollmentType: ENROLLMENT_TYPES.CHILD,
      tipoSangre: "O_POSITIVO",
    };
    expect(validateEnrollStep("health", data)).toEqual([]);
  });

  it("buildEnrollmentRequest omits contactoEmergencia/telefonoEmergencia for a child enrollment", (): void => {
    const data: EnrollFormData = {
      ...initialFormData,
      enrollmentType: ENROLLMENT_TYPES.CHILD,
      nombres: "Lucas", apellidos: "Martinez", cedula: "1798765432",
      fechaNacimiento: "2015-06-15", telefono: "991234567",
      nombreRepresentante: "Sofia", apellidosRepresentante: "Martinez",
      cedulaRepresentante: "1798765433", fechaNacimientoRepresentante: "1990-05-20",
      telefonoRepresentante: "0991234567", correoRepresentante: "sofia@example.com",
      contraseniaRepresentante: "password8",
      tipoSangre: "O_POSITIVO",
    };
    const request = buildEnrollmentRequest(data, true);
    expect(request.fichaMedica).not.toHaveProperty("contactoEmergencia");
    expect(request.fichaMedica).not.toHaveProperty("telefonoEmergencia");
  });

  it("buildEnrollmentRequest still includes both for a self (adult) enrollment", (): void => {
    const data: EnrollFormData = {
      ...initialFormData,
      enrollmentType: ENROLLMENT_TYPES.SELF,
      nombres: "Ana", apellidos: "Torres", cedula: "1798765432",
      fechaNacimiento: "1990-05-20", telefono: "991234567",
      correo: "ana@example.com", contrasenia: "password8",
      tipoSangre: "O_POSITIVO",
      contactoEmergencia: "María Torres",
      telefonoEmergencia: "987654321",
    };
    const request = buildEnrollmentRequest(data, true);
    expect(request.fichaMedica.contactoEmergencia).toBe("María Torres");
    expect(request.fichaMedica.telefonoEmergencia).toBe("0987654321");
  });
});

// ---------------------------------------------------------------------------
// The school/institution block was removed from the wizard: it was
// unnecessary information the product owner never asked the visitor for.
// ---------------------------------------------------------------------------
describe("the school/institution field no longer exists on this wizard", (): void => {
  it("ENROLL_FIELD_TOKEN has no institucionId key", (): void => {
    expect(ENROLL_FIELD_TOKEN).not.toHaveProperty("institucionId");
  });

  it("buildEnrollmentRequest's payload for a child enrollment has no institucionId", (): void => {
    const data: EnrollFormData = {
      ...initialFormData,
      enrollmentType: ENROLLMENT_TYPES.CHILD,
      nombres: "Lucas", apellidos: "Martinez", cedula: "1798765432",
      fechaNacimiento: "2015-06-15", telefono: "991234567",
      nombreRepresentante: "Sofia", apellidosRepresentante: "Martinez",
      cedulaRepresentante: "1798765433", fechaNacimientoRepresentante: "1990-05-20",
      telefonoRepresentante: "0991234567", correoRepresentante: "sofia@example.com",
      contraseniaRepresentante: "password8",
      tipoSangre: "O_POSITIVO",
    };
    const request = buildEnrollmentRequest(data, true);
    expect(request.alumno).not.toHaveProperty("institucionId");
  });
});

// Issue #1347 (item 1, R2-001/R3-002/R4-001, review advisory de #1346): a
// Stepper-originated jump used to arm the one-shot focus flag unconditionally,
// before calling `goToStep`. `goToStep` itself already no-ops when the
// destination equals the current step (`wizard-history.ts`), so a future
// caller that reaches this guard with a same-step jump — a defensive early
// return, or a future "clickable but not done" step — would leave the flag
// armed with no `step` change ever coming to consume it, and the NEXT
// ordinary "Siguiente"/"Atrás" would steal focus to the heading instead.
describe("shouldFocusStepHeadingOnJump", (): void => {
  it("arms the flag when the jump actually changes the step", (): void => {
    expect(shouldFocusStepHeadingOnJump("health", "personal")).toBe(true);
  });

  it("does not arm the flag when the destination is already the current step", (): void => {
    expect(shouldFocusStepHeadingOnJump("health", "health")).toBe(false);
  });
});

describe("QA4 REG-04 — email format is checked at step 2", () => {
  it.each(["a@b..com", "a@b.c", "a@.com", "a@b.com."])("rejects %s", (correo) => {
    const errors = validateEnrollStep(
      "personal",
      { ...initialFormData, enrollmentType: "self", correo },
    );
    expect(errors).toContain(
      "El correo electrónico no es válido. Revíselo; debe tener un formato como nombre@ejemplo.com.",
    );
  });

  it("accepts a normal address", () => {
    const errors = validateEnrollStep(
      "personal",
      { ...initialFormData, enrollmentType: "self", correo: "ana.perez@mail.ec" },
    );
    expect(errors.filter((e) => e.includes("correo electrónico no es válido"))).toEqual([]);
  });
});

describe("QA4 FAM-08 — option labels without internal codes", () => {
  it("plan label drops the code and says «al mes»", () => {
    expect(planOptionLabel("Mensual Adultos", 40)).toBe("Mensual Adultos — $40,00 al mes");
  });

  it("institution label is just the name", () => {
    expect(institutionOptionLabel("Colegio Municipal Sucre")).toBe("Colegio Municipal Sucre");
  });
});

describe("enrollmentTypeFromParam — the landing's ?type= (REG-25)", (): void => {
  it("maps the landing's own words and the older aliases", (): void => {
    expect(enrollmentTypeFromParam("self")).toBe(ENROLLMENT_TYPES.SELF);
    expect(enrollmentTypeFromParam("player")).toBe(ENROLLMENT_TYPES.SELF);
    expect(enrollmentTypeFromParam("child")).toBe(ENROLLMENT_TYPES.CHILD);
    expect(enrollmentTypeFromParam("representative")).toBe(ENROLLMENT_TYPES.CHILD);
  });

  it("answers null for anything else, prototype keys included", (): void => {
    for (const raw of [null, "", "SELF", " self", "admin", "constructor", "__proto__", "toString"]) {
      expect(enrollmentTypeFromParam(raw)).toBeNull();
    }
  });
});
