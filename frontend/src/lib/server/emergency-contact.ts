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

/**
 * The representative when the person has one with a phone, else the person's own contact, else null.
 *
 * The representative comes first because for a represented minor the backend
 * (#1138) already copies them into `contactoEmergencia`/`telefonoEmergencia`:
 * reading those as "the person's own" is what hid the representative from
 * every screen.
 */
export function resolveEffectiveEmergencyContact(source: EmergencyContactSource): EffectiveEmergencyContact | null {
  const representanteTelefono = present(source.representanteTelefono);
  if (representanteTelefono) {
    return {
      nombre: present(source.representanteNombreCompleto),
      telefono: representanteTelefono,
      esRepresentante: true,
    };
  }

  const nombre = present(source.contactoEmergencia);
  const telefono = present(source.telefonoEmergencia);
  if (nombre || telefono) return { nombre, telefono, esRepresentante: false };
  return null;
}
