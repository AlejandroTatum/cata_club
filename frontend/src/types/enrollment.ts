/** Public enrollment API contract for POST /api/v1/enrollment/. */

export const BLOOD_TYPES = {
  A_POSITIVO: "A_POSITIVO",
  A_NEGATIVO: "A_NEGATIVO",
  B_POSITIVO: "B_POSITIVO",
  B_NEGATIVO: "B_NEGATIVO",
  AB_POSITIVO: "AB_POSITIVO",
  AB_NEGATIVO: "AB_NEGATIVO",
  O_POSITIVO: "O_POSITIVO",
  O_NEGATIVO: "O_NEGATIVO",
  DESCONOCIDO: "DESCONOCIDO",
} as const;

export type BloodType = (typeof BLOOD_TYPES)[keyof typeof BLOOD_TYPES];

/**
 * The blood types a person may CHOOSE (issue #643).
 *
 * `BLOOD_TYPES` above is the wire vocabulary — every value the backend may
 * hand us — and it keeps `DESCONOCIDO` because records written before this
 * rule existed still hold it, and no migration invents a real blood type for
 * them. This narrower list is what may be written from now on.
 *
 * The two used to be one list, and that is precisely how the wizard came to
 * offer "No lo sé" as an answer to a question the business rule says must be
 * answered: `isBloodType` asked "is this in the enum?", the enum said yes, and
 * a record full of `DESCONOCIDO` then looked complete to every screen reading
 * it. Reading and writing need different vocabularies, so they get two lists.
 */
export const SELECTABLE_BLOOD_TYPES: readonly Exclude<BloodType, "DESCONOCIDO">[] = [
  BLOOD_TYPES.A_POSITIVO,
  BLOOD_TYPES.A_NEGATIVO,
  BLOOD_TYPES.B_POSITIVO,
  BLOOD_TYPES.B_NEGATIVO,
  BLOOD_TYPES.AB_POSITIVO,
  BLOOD_TYPES.AB_NEGATIVO,
  BLOOD_TYPES.O_POSITIVO,
  BLOOD_TYPES.O_NEGATIVO,
];

/** True when `value` is a blood type a person is allowed to pick. */
export function isSelectableBloodType(value: unknown): value is Exclude<BloodType, "DESCONOCIDO"> {
  return typeof value === "string" &&
    (SELECTABLE_BLOOD_TYPES as readonly string[]).includes(value);
}

/**
 * What each blood type is CALLED on screen.
 *
 * The wizard used to print the enum with its underscore swapped for a space —
 * "O POSITIVO", "AB NEGATIVO" — in the option list and again in the summary.
 * That is the backend's spelling wearing a costume: shouted, and not the way
 * anybody writes a blood type. The enum stays the wire value; this table is
 * the only thing a person reads.
 */
export const BLOOD_TYPE_LABELS: Record<BloodType, string> = {
  A_POSITIVO: "A positivo",
  A_NEGATIVO: "A negativo",
  B_POSITIVO: "B positivo",
  B_NEGATIVO: "B negativo",
  AB_POSITIVO: "AB positivo",
  AB_NEGATIVO: "AB negativo",
  O_POSITIVO: "O positivo",
  O_NEGATIVO: "O negativo",
  DESCONOCIDO: "No lo sé",
};

export interface EnrollmentStudent {
  nombres: string;
  apellidos: string;
  cedula: string;
  fechaNacimiento: string;
  telefono: string;
  institucionId?: number;
}

export interface EnrollmentCredentials {
  correo: string;
  contrasenia: string;
}

export interface EnrollmentRepresentative extends EnrollmentStudent, EnrollmentCredentials {}

export interface EnrollmentMedicalRecord {
  tipoSangre: BloodType;
  condicionesSalud: string;
  alergias: string;
  contactoEmergencia: string;
  telefonoEmergencia: string;
  observaciones?: string;
}

export interface EnrollmentRequest {
  alumno: EnrollmentStudent;
  fichaMedica: EnrollmentMedicalRecord;
  credencialesAlumno?: EnrollmentCredentials;
  /** Optional credentials for the minor (child enrollment). When provided,
   *  a Usuario with rol ALUMNO is also created for the student. */
  credencialesMenor?: EnrollmentCredentials;
  representante?: EnrollmentRepresentative;
}

export interface EnrollmentResponse {
  enrolled: true;
}

export interface AddChildStudent {
  nombres: string;
  apellidos: string;
  cedula: string;
  fechaNacimiento: string;
  telefono: string;
}

export interface AddChildMedicalRecord {
  tipoSangre: BloodType;
  condicionesSalud: string;
  alergias: string;
  contactoEmergencia: string;
  telefonoEmergencia: string;
  observaciones?: string;
}

export interface AddChildRequest {
  alumno: AddChildStudent;
  fichaMedica?: AddChildMedicalRecord;
}

export interface AddChildResponse {
  persona_id: number;
  mensaje: string;
}
