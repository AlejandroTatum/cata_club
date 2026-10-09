/**
 * What's new — the release notes shown once after login.
 *
 * A release only edits this file: bump `WHATS_NEW_VERSION` and rewrite the
 * copy. The version is what the browser remembers, so a bump shows the dialog
 * again to everyone, once. The copy is owner-approved, non-technical Spanish.
 */

import type { UserRole } from "@/types/domain";

export const WHATS_NEW_VERSION = "2026.10-nueva-imagen";

/** One `localStorage` key holds the version the browser has already seen. */
export const WHATS_NEW_STORAGE_KEY = "cata:whats-new-seen";

export type WhatsNewAudience = "admin" | "entrenador" | "alumno";

export const WHATS_NEW_HEADER = {
  title: "CataClub se renovó",
  intro:
    "Le dimos una nueva imagen al sistema para que sea más claro y cómodo de usar, sobre todo desde el celular. Ahora las ventanas y los avisos aparecen con más suavidad.",
} as const;

export const WHATS_NEW_ITEMS: Record<WhatsNewAudience, readonly string[]> = {
  admin: [
    "Modo oscuro: actívalo desde tu menú de cuenta, también en el inicio de sesión.",
    "Miembros más claros: la membresía y el representante aparecen solo en quienes juegan.",
    "Pagos más fáciles de revisar: los nombres se leen completos y las bonificaciones se muestran de a 10.",
    "Carnets renovados: elegir e imprimir carnets ahora es más simple.",
    "¿Algo no anda? El botón para reportar un problema está siempre arriba, en la barra.",
  ],
  entrenador: [
    "Modo oscuro: actívalo desde tu menú de cuenta.",
    "Tu lista y tus grupos, más livianos: filas más compactas y fáciles de leer.",
    "Mejor en el celular: botones más grandes y más fáciles de tocar.",
    "¿Algo no anda? El botón para reportar un problema está siempre arriba, en la barra.",
  ],
  alumno: [
    "Modo oscuro: actívalo desde tu menú de cuenta.",
    "Tu panel, de un vistazo: tu membresía y tus números importantes se ven claros apenas entras.",
    "Pagos más claros: el estado de cada pago se entiende sin tener que abrirlo.",
    "Mejor en el celular: botones más grandes y pantallas más ordenadas.",
  ],
};

export const WHATS_NEW_ACTIONS = {
  dismiss: "Entendido",
  help: "Ver ayuda",
  helpHref: "/ayuda",
} as const;

/** Highest priority first: admin > entrenador > estudiante/representante. */
const AUDIENCE_BY_ROLE: readonly (readonly [UserRole, WhatsNewAudience])[] = [
  ["admin", "admin"],
  ["trainer", "entrenador"],
  ["estudiante", "alumno"],
  ["representante", "alumno"],
];

/** The list a user sees, or `null` (header and button only) for an unknown role. */
export function whatsNewAudienceFor(roles: readonly UserRole[]): WhatsNewAudience | null {
  for (const [role, audience] of AUDIENCE_BY_ROLE) {
    if (roles.includes(role)) return audience;
  }
  return null;
}

/**
 * The bold lead: the text up to the first colon, or a leading «¿…?» question
 * (the approved copy bolds «¿Algo no anda?»). A bullet with neither has none.
 */
export function splitLead(item: string): { lead: string | null; rest: string } {
  const question = item.startsWith("¿") ? item.indexOf("?") : -1;
  const end = question !== -1 ? question : item.indexOf(":");
  if (end === -1) return { lead: null, rest: item };
  return { lead: item.slice(0, end + 1), rest: item.slice(end + 1) };
}
