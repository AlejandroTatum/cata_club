import { heading, paragraph, type LegalBlock } from "../terminos/legal-content";

/**
 * Document 2, version 2.2 (the lawyer-approved 2.1 reworded so acceptance is mandatory; pending lawyer validation): consent for the
 * processing of health data. Otherwise verbatim.
 */
export const legalBlocks: readonly LegalBlock[] = [
  heading("Propósito y alcance"),
  paragraph("Este consentimiento es independiente de los Términos, condiciones y acuerdo de responsabilidad, pero su aceptación es obligatoria: se acepta junto con ellos y con el Permiso de uso de imagen, y sin él no se crea la cuenta. Con él usted autoriza expresamente que Cata Club trate datos de salud, que la ley considera datos sensibles. El club lo exige porque necesita la ficha médica para atender al jugador en una emergencia."),
  heading("Quién trata los datos"),
  paragraph("Lucía Catalina Cedillo Flor, C.I. 0102724358, propietaria de Cata Club, Loja, Ecuador. Correo: cataclub.loja@proton.me."),
  heading("Qué datos de salud tratamos"),
  paragraph("La ficha médica del jugador: tipo de sangre, alergias, enfermedades que debamos conocer, y el nombre y teléfono de una persona de contacto en caso de emergencia."),
  heading("Para qué los usamos"),
  paragraph("Solo para proteger la salud y la seguridad del jugador durante las actividades del club: saber qué hacer y a quién llamar si hay una lesión, un malestar o una emergencia, y poder informar a los servicios de salud que atiendan al jugador. No los usamos para ningún otro fin ni los publicamos."),
  heading("Quién puede verlos"),
  paragraph("• El administrador del club."),
  paragraph("• El representante del jugador."),
  paragraph("• El entrenador, solo en una emergencia, a través de una vía especial. Cada consulta de emergencia queda registrada y puede ser auditada."),
  paragraph("Los datos se guardan con acceso restringido por roles, según el Capítulo VIII de los Términos, condiciones y acuerdo de responsabilidad. Se almacenan en los servidores y con los proveedores de la plataforma descritos en ese capítulo."),
  heading("Cuánto tiempo los conservamos"),
  paragraph("Mientras el jugador tenga una cuenta activa. Si se cierra la cuenta, la ficha médica se elimina después del plazo de 30 días explicado en el Capítulo VIII de los Términos, condiciones y acuerdo de responsabilidad, salvo en los respaldos, que se renuevan de forma rotativa."),
  heading("Quién autoriza"),
  paragraph("• Jugadores menores de 15 años: autoriza su representante legal."),
  paragraph("• Jugadores de 15 a 17 años: autoriza el propio adolescente, con conocimiento de su representante."),
  paragraph("• Jugadores mayores de edad: autorizan ellos mismos."),
  heading("Sus derechos y cómo retirar esta autorización"),
  paragraph("Usted puede retirar esta autorización en cualquier momento, desde la plataforma o escribiendo a cataclub.loja@proton.me, y puede indicar el motivo si lo desea. El retiro vale hacia adelante. Tras el retiro, la ficha médica ya no se usará y se tratará según lo que explica el Capítulo VIII de los Términos, condiciones y acuerdo de responsabilidad sobre eliminación. Como esta autorización es condición para usar el servicio, mientras esté retirada la cuenta quedará limitada a revisar los documentos y cerrar sesión, y el club no podrá consultar los datos de salud en una emergencia."),
  paragraph("También tiene los demás derechos descritos en ese capítulo (acceso, rectificación, eliminación, oposición y reclamo ante la Superintendencia de Protección de Datos Personales)."),
  heading("Cómo queda registrada su autorización"),
  paragraph("La plataforma guarda qué versión aceptó, la fecha y su cuenta; y, si la retira, la fecha y el motivo. No se acepta nunca de forma automática."),
];

/** Key points of the document above, for the side summary. Nothing here goes beyond the text. */
export const summary: readonly string[] = [
  "Su aceptación es obligatoria: se acepta junto con los Términos y el Permiso de uso de imagen, y sin él no se crea la cuenta.",
  "Cubre la ficha médica: tipo de sangre, alergias, enfermedades y contacto de emergencia.",
  "Se usa solo para proteger la salud y la seguridad del jugador; no se publica.",
  "El entrenador solo la consulta en una emergencia, y cada consulta queda registrada.",
  "Puede retirar la autorización en cualquier momento; el retiro vale hacia adelante.",
];
