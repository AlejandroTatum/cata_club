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

function digits(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * The person's own declared contact, else the representative (when they have
 * a phone), else null.
 *
 * For a represented minor the backend (#1138) copies the representative into
 * `contactoEmergencia`/`telefonoEmergencia`, so a stored contact with the
 * representative's phone is the representative, not a contact of their own.
 * A different contact chosen on purpose is never replaced.
 */
export function resolveEffectiveEmergencyContact(source: EmergencyContactSource): EffectiveEmergencyContact | null {
  const nombre = present(source.contactoEmergencia);
  const telefono = present(source.telefonoEmergencia);
  const representanteTelefono = present(source.representanteTelefono);

  const isRepresentativeCopy =
    representanteTelefono !== null && (telefono === null || digits(telefono) === digits(representanteTelefono));
  if (representanteTelefono && isRepresentativeCopy) {
    return {
      nombre: present(source.representanteNombreCompleto) ?? nombre,
      telefono: representanteTelefono,
      esRepresentante: true,
    };
  }

  if (nombre || telefono) return { nombre, telefono, esRepresentante: false };
  return null;
}
