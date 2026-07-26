/**
 * The club's FAQ, as browsable content.
 *
 * ## Why this exists rather than only the assistant
 *
 * P10 was capped at 8 for one reason: the only way to get an answer was to
 * think of a question and type it. That works when you know what you are
 * looking for and fails completely when you do not — a family who has never
 * used the app cannot ask "¿a qué hora entrena mi hijo?" if they do not yet
 * know the club sorts by category. Browsing answers a different question from
 * searching, and the product only had searching.
 *
 * ## Why the content is duplicated here, and what stops it drifting
 *
 * The authority is `_FAQ_CONTENIDO` in
 * `backend/app/servicios_negocio/chatbot_servicio.py` — the same text the
 * assistant is grounded in. There is no endpoint that serves it (the chatbot
 * contract returns a single answer string and nothing else), so the choice was
 * a backend change or a copy.
 *
 * A copy, with the drift made testable: `faq-content.test.ts` reads the Python
 * file and asserts every training time below still matches it. Those are the
 * facts a family plans their week around, and they are the ones that would
 * hurt if the two ever disagreed. The rest is guidance about how the app
 * works, which changes with the app and is covered by review.
 */

export interface FaqSchedule {
  /** The category, as the club names it. */
  category: string;
  /** Who it is for, in plain words. */
  ages: string;
  days: string;
  hours: string;
}

/**
 * Fixed club training times. Kept in the same order the FAQ lists them —
 * youngest first — because that is the order a parent scans.
 */
export const FAQ_SCHEDULES: FaqSchedule[] = [
  { category: "Formativo", ages: "5 a 10 años", days: "Lunes a viernes", hours: "15:00 a 16:00" },
  { category: "Infantil", ages: "8 a 12 años", days: "Lunes a viernes", hours: "16:00 a 17:00" },
  { category: "Juvenil", ages: "Mayores de 12 años", days: "Lunes a viernes", hours: "17:00 a 18:00" },
  { category: "Competitivo", ages: "Selección", days: "Lunes a sábado", hours: "18:00 a 20:00" },
  { category: "Adultos", ages: "Mayores de 18 años", days: "Lunes a viernes", hours: "20:00 a 21:15" },
];

export interface FaqEntry {
  question: string;
  answer: string;
}

export interface FaqSection {
  /** Who this section is for, named the way the club would say it. */
  title: string;
  entries: FaqEntry[];
}

export const FAQ_SECTIONS: FaqSection[] = [
  {
    title: "Para empezar",
    entries: [
      {
        question: "¿Cómo inicio sesión?",
        answer:
          "Con su correo y su contraseña, en la pantalla de inicio de sesión. Si olvidó la contraseña, desde esa misma pantalla puede pedir un enlace de recuperación por correo.",
      },
      {
        question: "¿Por qué mi pantalla no se parece a la de otra persona del club?",
        answer:
          "Cada quien ve solo lo suyo. Un administrador ve la gestión completa del club; un entrenador ve lo de sus grupos; una familia ve Mi Cuenta, con su propia información y nada más.",
      },
    ],
  },
  {
    title: "Si es estudiante o representante",
    entries: [
      {
        question: "¿Dónde veo si mi pago fue aprobado?",
        answer:
          "En Mi Cuenta. Ahí aparece el estado de cada pago y el de la membresía. Si un pago fue rechazado, verá el motivo y podrá subir un comprobante nuevo.",
      },
      {
        question: "¿Dónde veo la asistencia?",
        answer:
          "También en Mi Cuenta. Cada registro muestra el día y el horario de esa clase, así que ahí mismo puede ver a qué hora entrena.",
      },
      {
        question: "Necesito corregir la ficha médica. ¿Puedo hacerlo yo?",
        answer:
          "No: la ficha médica (alergias, contacto de emergencia) la gestiona un administrador del club. Pídaselo y ellos la actualizan.",
      },
      {
        question: "Represento a más de un hijo. ¿Cómo cambio entre ellos?",
        answer:
          "Con el selector de estudiante que aparece arriba en Mi Cuenta. Lo que elija se mantiene mientras navega entre pantallas.",
      },
    ],
  },
  {
    title: "Si es entrenador",
    entries: [
      {
        question: "¿Cómo tomo asistencia?",
        answer:
          "Desde Asistencia. Elige el horario, pasa lista y confirma. Todos empiezan en Presente para que una sesión completa no cueste ni un toque, y el contador de sin revisar le dice a cuántos todavía nadie miró.",
      },
      {
        question: "Me equivoqué al marcar. ¿Puedo deshacerlo?",
        answer:
          "Sí. El botón Deshacer de la barra inferior revierte la última marca, y también la acción de marcar a todos los restantes como presentes.",
      },
      {
        question: "¿Dónde veo lo que ya cargué?",
        answer: "En Historial Asistencia, con las listas que usted mismo registró.",
      },
    ],
  },
  {
    title: "Si es administrador",
    entries: [
      {
        question: "¿Cómo valido un pago?",
        answer:
          "Desde Membresías y Pagos. Antes de aprobar tiene que confirmar lo que revisó; las preguntas cambian según el pago: un comprobante se revisa como comprobante, y un pago en efectivo recibido en persona no le pide certificar un comprobante que no existe.",
      },
      {
        question: "Tengo muchos pagos iguales. ¿Debo aprobarlos de a uno?",
        answer:
          "No. Puede seleccionar varios en la cola y aprobarlos juntos. Sigue confirmando lo que revisó, pero una sola vez para todo el lote.",
      },
      {
        question: "Aprobé un pago por error. ¿Puedo revertirlo?",
        answer:
          "Durante unos segundos, sí: la decisión queda retenida y Deshacer la cancela antes de que salga. Pasado ese momento, el pago ya quedó registrado.",
      },
      {
        question: "¿Qué son los niveles?",
        answer:
          "Los niveles son grupos de entrenamiento, no una clasificación competitiva. Ahí se asigna a cada estudiante, respetando el cupo mínimo y máximo de cada nivel. En la escalera del club, el nivel 1 es la cima.",
      },
      {
        question: "¿Quién define los horarios?",
        answer:
          "El administrador, desde Gestión de Horarios. Cada horario queda asociado a un grupo y a un entrenador.",
      },
    ],
  },
];
