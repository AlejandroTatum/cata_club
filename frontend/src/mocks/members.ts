/**
 * Centralized mock data for members.
 *
 * Shared across pages (members, groups, attendance, trainer) and tests.
 * Moved from src/app/members/members-utils.ts to create a clear mock-data
 * boundary that makes the transition to a real backend easier.
 *
 * Do NOT add business logic here. This file is mock data only — pure
 * functions belong in src/lib/*-utils.ts or the respective *-utils.ts files.
 * The two builders below are the one exception: they are private,
 * file-scoped object-literal constructors that shape this file's own data
 * (not exported, not reused elsewhere), so they stay data-shaping rather
 * than business logic.
 *
 * Issue #388 — one row per PERSON, not one row per paying root. Every
 * persona (root or represented) gets its own `MemberAccount` with its own
 * membership/payment status; a represented persona's row also carries
 * `representadoPor` (their representative's full name), and a self-managed
 * root's row leaves it `undefined`. This mirrors the real
 * `buildMemberAccounts` shape (src/lib/server/members-adapter.ts) instead of
 * the old grouped-by-root shape it replaced.
 */

import type {
  MemberAccount,
  MemberStudentSummary,
} from "@/app/members/members-utils";

type Membresia = MemberStudentSummary["membresia"];
type UltimoPago = MemberStudentSummary["ultimoPago"];

// ---------------------------------------------------------------------------
// Fixture builders (private — shape this file's own data, not business logic)
// ---------------------------------------------------------------------------

/**
 * A self-managed root: a person who represents only themselves and has no
 * membership/payment on file — the "root" persona in a family group,
 * distinct from the players they represent.
 */
function buildSelfManagedRoot(params: {
  id: string;
  nombres: string;
  apellidos: string;
  email: string;
  telefono: string;
}): MemberAccount {
  const { id, nombres, apellidos, email, telefono } = params;
  return {
    id,
    role: "representante",
    nombres,
    apellidos,
    email,
    telefono,
    estudiantes: [
      {
        id,
        nombres,
        apellidos,
        email,
        activo: true,
        membresia: null,
        ultimoPago: null,
      },
    ],
  };
}

/**
 * A represented member: a player whose account is represented by someone
 * else, with their own membership/payment status (which may be `null` when
 * they have neither on file yet).
 */
function buildRepresentedMember(params: {
  id: string;
  nombres: string;
  apellidos: string;
  email: string;
  telefono: string;
  representadoPor: string;
  fechaNacimiento: string;
  membresia: Membresia;
  ultimoPago: UltimoPago;
}): MemberAccount {
  const {
    id,
    nombres,
    apellidos,
    email,
    telefono,
    representadoPor,
    fechaNacimiento,
    membresia,
    ultimoPago,
  } = params;
  return {
    id,
    role: "representante",
    nombres,
    apellidos,
    email,
    telefono,
    representadoPor,
    estudiantes: [
      {
        id,
        nombres,
        apellidos,
        email,
        fechaNacimiento,
        activo: true,
        membresia,
        ultimoPago,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Mock accounts
// ---------------------------------------------------------------------------

export const MOCK_MEMBER_ACCOUNTS: MemberAccount[] = [
  // --- Carlos Martínez and the three players he represents ------------------
  buildSelfManagedRoot({
    id: "rp-001",
    nombres: "Carlos",
    apellidos: "Martínez",
    email: "carlos.martinez@email.com",
    telefono: "+593 99 123 4567",
  }),
  buildRepresentedMember({
    id: "stu-001",
    nombres: "Sofía",
    apellidos: "Martínez",
    email: "sofia.martinez@email.com",
    telefono: "+593 99 123 4567",
    representadoPor: "Carlos Martínez",
    fechaNacimiento: "2014-03-15",
    membresia: {
      tipo: "mensual",
      estado: "activa",
      fechaInicio: "2026-07-01",
      fechaFin: "2026-07-31",
      monto: 85,
      id: 1,
    },
    ultimoPago: {
      estado: "aprobado",
      fechaPago: "2026-06-28",
      monto: 85,
      periodo: "Julio 2026",
    },
  }),
  buildRepresentedMember({
    id: "stu-002",
    nombres: "Mateo",
    apellidos: "Martínez",
    email: "mateo.martinez@email.com",
    telefono: "+593 99 123 4567",
    representadoPor: "Carlos Martínez",
    fechaNacimiento: "2012-08-22",
    membresia: {
      tipo: "mensual",
      estado: "activa",
      fechaInicio: "2026-07-01",
      fechaFin: "2026-07-31",
      monto: 85,
      id: 2,
    },
    ultimoPago: {
      estado: "pendiente_validacion",
      fechaPago: "2026-06-27",
      monto: 85,
      periodo: "Julio 2026",
    },
  }),
  buildRepresentedMember({
    id: "stu-003",
    nombres: "Emilia",
    apellidos: "Martínez",
    email: "emilia.martinez@email.com",
    telefono: "+593 99 123 4567",
    representadoPor: "Carlos Martínez",
    fechaNacimiento: "2016-11-05",
    membresia: {
      tipo: "mensual",
      estado: "vencida",
      fechaInicio: "2026-06-01",
      fechaFin: "2026-06-30",
      monto: 85,
      id: 3,
    },
    ultimoPago: {
      estado: "pendiente_validacion",
      fechaPago: "2026-06-29",
      monto: 85,
      periodo: "Agosto 2026",
    },
  }),

  // --- Ana López and the player she represents -------------------------------
  buildSelfManagedRoot({
    id: "rp-002",
    nombres: "Ana",
    apellidos: "López",
    email: "ana.lopez@email.com",
    telefono: "+593 98 765 4321",
  }),
  buildRepresentedMember({
    id: "stu-004",
    nombres: "Valentina",
    apellidos: "López",
    email: "valentina.lopez@email.com",
    telefono: "+593 98 765 4321",
    representadoPor: "Ana López",
    fechaNacimiento: "2010-02-10",
    membresia: {
      tipo: "trimestral",
      estado: "activa",
      fechaInicio: "2026-07-01",
      fechaFin: "2026-09-30",
      monto: 240,
      id: 4,
    },
    ultimoPago: {
      estado: "aprobado",
      fechaPago: "2026-06-26",
      monto: 240,
      periodo: "Julio — Septiembre 2026",
    },
  }),

  // --- Diego Flores and the player he represents ------------------------------
  buildSelfManagedRoot({
    id: "rp-003",
    nombres: "Diego",
    apellidos: "Flores",
    email: "diego.flores@email.com",
    telefono: "+593 97 654 3210",
  }),
  buildRepresentedMember({
    id: "stu-005",
    nombres: "Camila",
    apellidos: "Flores",
    email: "camila.flores@email.com",
    telefono: "+593 97 654 3210",
    representadoPor: "Diego Flores",
    fechaNacimiento: "2015-06-18",
    membresia: {
      tipo: "mensual",
      estado: "vencida",
      fechaInicio: "2026-06-01",
      fechaFin: "2026-06-30",
      monto: 85,
      id: 5,
    },
    ultimoPago: null,
  }),

  // --- Nicolás Acosta, self-managed (no representative) -----------------------
  // Unique shape (self-managed root WITH a real membership, role
  // "estudiante") — a single occurrence, so it stays a plain literal rather
  // than a third one-use builder.
  {
    id: "rp-004",
    role: "estudiante",
    nombres: "Nicolás",
    apellidos: "Acosta",
    email: "nicolas.acosta@email.com",
    telefono: "+593 96 543 2109",
    estudiantes: [
      {
        id: "rp-004",
        nombres: "Nicolás",
        apellidos: "Acosta",
        email: "nicolas.acosta@email.com",
        activo: true,
        membresia: {
          tipo: "anual",
          estado: "activa",
          fechaInicio: "2026-01-01",
          fechaFin: "2026-12-31",
          monto: 720,
          id: 6,
        },
        ultimoPago: {
          estado: "aprobado",
          fechaPago: "2025-12-20",
          monto: 720,
          periodo: "Anual 2026",
        },
      },
    ],
  },

  // --- Carlos Ramírez and the two players he represents ------------------------
  buildSelfManagedRoot({
    id: "rp-005",
    nombres: "Carlos",
    apellidos: "Ramírez",
    email: "carlos.ramirez@email.com",
    telefono: "+593 95 432 1098",
  }),
  buildRepresentedMember({
    id: "stu-007",
    nombres: "Santiago",
    apellidos: "Ramírez",
    email: "santiago.ramirez@email.com",
    telefono: "+593 95 432 1098",
    representadoPor: "Carlos Ramírez",
    fechaNacimiento: "2013-09-30",
    membresia: {
      tipo: "mensual",
      estado: "vencida",
      fechaInicio: "2026-06-01",
      fechaFin: "2026-06-30",
      monto: 85,
      id: 7,
    },
    ultimoPago: {
      estado: "pendiente_validacion",
      fechaPago: "2026-06-26",
      monto: 85,
      periodo: "Julio 2026",
    },
  }),
  buildRepresentedMember({
    id: "stu-008",
    nombres: "Isabella",
    apellidos: "Morales",
    email: "isabella.morales@email.com",
    telefono: "+593 95 432 1098",
    representadoPor: "Carlos Ramírez",
    fechaNacimiento: "2014-12-12",
    membresia: {
      tipo: "mensual",
      estado: "vencida",
      fechaInicio: "2026-05-01",
      fechaFin: "2026-05-31",
      monto: 85,
      id: 8,
    },
    ultimoPago: null,
  }),

  // --- Lucía Mendoza and the player she represents ------------------------------
  buildSelfManagedRoot({
    id: "rp-006",
    nombres: "Lucía",
    apellidos: "Mendoza",
    email: "lucia.mendoza@email.com",
    telefono: "+593 94 321 0987",
  }),
  buildRepresentedMember({
    id: "stu-009",
    nombres: "Joaquín",
    apellidos: "Mendoza",
    email: "joaquin.mendoza@email.com",
    telefono: "+593 94 321 0987",
    representadoPor: "Lucía Mendoza",
    fechaNacimiento: "2017-04-20",
    membresia: null,
    ultimoPago: null,
  }),
];
