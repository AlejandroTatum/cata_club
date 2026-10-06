import { heading, paragraph, type LegalBlock } from "./legal-content";

/**
 * BORRADOR (issue #1666) — NOT PUBLISHED, NOT WIRED INTO ANY PAGE.
 *
 * Proposed wording for the legal document (`content.ts`, currently version 2.3)
 * now that a minor can have a second guardian. It is a draft for the club and
 * its lawyer to review: nothing here has been approved, and nothing renders it.
 *
 * RELEASE IS BLOCKED until the club/lawyer approve this text. Publishing it
 * means: moving each block below into its chapter in `content.ts`, bumping
 * `VERSION_LEGAL_VIGENTE` in `backend/app/servicios_negocio/
 * consentimiento_legal_servicio.py` (which makes every account re-accept), and
 * deleting this file. `__tests__/borrador-segundo-representante.test.ts` fails
 * if this text reaches the published document before that decision.
 *
 * The same text, readable without code, is in
 * `docs/privacy-draft-second-guardian.md` for the reviewers.
 */
export const BORRADOR_SEGUNDO_REPRESENTANTE_ESTADO = "BORRADOR";

/** The chapter of `content.ts` each draft block would be added to or replace. */
export interface BorradorSeccion {
  /** Where it goes in the published document. */
  readonly destino: string;
  /** `añadir`: new paragraph(s); `reemplazar`: replaces the sentence quoted in `reemplaza`. */
  readonly accion: "añadir" | "reemplazar";
  readonly reemplaza?: string;
  readonly bloques: readonly LegalBlock[];
}

export const borradorSegundoRepresentante: readonly BorradorSeccion[] = [
  {
    destino: "Capítulo III. Cómo se usa el sistema — «Menores y representantes»",
    accion: "añadir",
    bloques: [
      paragraph("Un jugador menor de edad puede tener hasta dos representantes con cuenta propia en el sistema: el representante principal y, si el principal lo decide, un segundo representante. El representante principal invita al segundo por correo electrónico y puede quitarlo en cualquier momento; el administrador del club también puede agregarlo o quitarlo. El acceso del segundo representante termina en el momento en que se lo quita."),
      paragraph("El segundo representante puede ver la información del jugador, recibir sus avisos, pagar su membresía, subir comprobantes y editar sus datos generales. No puede firmar ni editar la ficha médica ni los consentimientos legales del jugador: esas decisiones corresponden al representante principal, y el segundo representante solo puede verlas."),
    ],
  },
  {
    destino: "Capítulo VIII. Protección de datos personales — «Quién puede ver sus datos»",
    accion: "reemplazar",
    reemplaza: "• Ficha médica: el administrador del club y el representante del jugador.",
    bloques: [
      paragraph("• Ficha médica: el administrador del club y los representantes del jugador (el principal y, si lo hay, el segundo). El segundo representante solo la ve; no la firma ni la edita."),
    ],
  },
  {
    destino: "Capítulo VIII. Protección de datos personales — «Quién puede ver sus datos»",
    accion: "reemplazar",
    reemplaza: "• Datos de cuenta y de jugadores: cada persona ve lo suyo y lo de los jugadores que representa.",
    bloques: [
      paragraph("• Datos de cuenta y de jugadores: cada persona ve lo suyo y lo de los jugadores que representa, sea como representante principal o como segundo representante. Los dos representantes de un jugador reciben sus avisos y correos y ven su información, sus pagos y sus recibos."),
    ],
  },
  {
    destino: "Capítulo VIII. Protección de datos personales — «Menores y representantes en materia de datos»",
    accion: "añadir",
    bloques: [
      paragraph("Cuando el representante principal agrega a un segundo representante, los datos del jugador menor de edad, incluidos los de salud, quedan visibles para esa otra persona adulta. El representante principal debe hacerlo únicamente con una persona de su confianza y con derecho a conocer esos datos. El club registra quién agregó o quitó a un segundo representante, a quién y cuándo, y conserva ese registro para poder demostrarlo."),
      paragraph("El segundo representante recibe el mismo deber de reserva que el representante principal: usa estos datos solo para el cuidado y la gestión de la participación del jugador en el club. Si usted no desea que otra persona vea los datos de su hijo o hija, no la invite; si ya lo hizo, puede quitarla desde su cuenta."),
    ],
  },
  {
    destino: "Capítulo VIII. Protección de datos personales — «Sus derechos» y «Cuánto tiempo conservamos sus datos»",
    accion: "añadir",
    bloques: [
      paragraph("Los derechos sobre los datos de un jugador menor de 15 años los ejerce su representante principal. El segundo representante puede pedir al club, por los canales de contacto, que se le explique cómo se tratan los datos que ve. Si el segundo representante pide eliminar su cuenta, se lo retira del jugador y se conserva el registro de su alta y su baja."),
    ],
  },
  {
    destino: "Consentimiento para el tratamiento de datos de salud — «Quién autoriza»",
    accion: "añadir",
    bloques: [
      paragraph("Para los jugadores menores de 15 años autoriza su representante legal principal. El segundo representante, si lo hay, puede ver este consentimiento y la ficha médica, pero no los firma ni los retira."),
    ],
  },
];
