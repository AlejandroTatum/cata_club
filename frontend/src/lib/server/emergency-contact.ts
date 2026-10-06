/**
 * Effective emergency contact (#1667). A minor has no emergency contact of
 * their own: #1138 derives it from the representative, so the screens read
 * "who do we call" from here instead of each re-deriving it from the raw
 * ficha fields. Server-only, used by the BFF emergency route.
 */

export interface EmergencyContactSource {
  contactoEmergencia: string | null;
  telefonoEmergencia: string | null;
  representanteNombreCompleto: string | null;
  representanteTelefono: string | null;
}

export interface EffectiveEmergencyContact {
  nombre: string | null;
  telefono: string | null;
  /** True when the contact is the representative, not one the person declared. */
  esRepresentante: boolean;
}

function present(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** The person's own contact when they have one, else the representative (needs a phone), else null. */
export function resolveEffectiveEmergencyContact(source: EmergencyContactSource): EffectiveEmergencyContact | null {
  const nombre = present(source.contactoEmergencia);
  const telefono = present(source.telefonoEmergencia);
  if (nombre || telefono) return { nombre, telefono, esRepresentante: false };

  const representanteTelefono = present(source.representanteTelefono);
  if (!representanteTelefono) return null;
  return {
    nombre: present(source.representanteNombreCompleto),
    telefono: representanteTelefono,
    esRepresentante: true,
  };
}
