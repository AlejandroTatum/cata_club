import { heading, paragraph, type LegalBlock } from "./legal-content";
import { healthChapter } from "./health-chapter";
import { imageChapter } from "./image-chapter";

/** The anchor of the privacy chapter: old `/privacidad` links resolve here. */
export const PRIVACY_CHAPTER_ID = "privacidad";
/** The anchors of the health-data and image chapters: the old pages redirect here. */
export const HEALTH_CHAPTER_ID = "consentimiento-salud";
export const IMAGE_CHAPTER_ID = "permiso-imagen";

/**
 * The single public document, version 2.2 (the lawyer-approved 2.1 reworded so acceptance is mandatory; pending lawyer validation): terms, conditions and
 * liability agreement. The privacy notice (VIII), the health-data consent (X)
 * and the image permission (XI) are chapters of it, not separate documents
 * (#1615). Published verbatim.
 */
export const legalBlocks: readonly LegalBlock[] = [
  paragraph("Al aceptar estos términos, usted se compromete a usar la plataforma conforme a ellos."),

  heading("Capítulo I. Quiénes somos y objeto"),
  paragraph("Lucía Catalina Cedillo Flor, con cédula de ciudadanía 0102724358, propietaria de Cata Club (en adelante, «el club»), opera el club de tenis de mesa de Loja, Ecuador. Dirección: Av. Manuel Agustín Aguirre, Barrio Perpetuo Socorro, junto al Coliseo Ciudad de Loja, Loja, Ecuador. Correo: cataclub.loja@proton.me. WhatsApp: 0994219619 y 0990288152."),
  paragraph("La plataforma de Cata Club permite crear una cuenta, registrar jugadores, consultar horarios y asistencia, ver membresías, subir comprobantes de pago y ver los recibos del club. Estos términos regulan su uso. El club es también el responsable del tratamiento de los datos personales (Capítulo VIII)."),

  heading("Capítulo II. Compromisos del club"),
  paragraph("El club se compromete a:"),
  paragraph("• Hacer lo posible para que la plataforma funcione de forma segura y continua."),
  paragraph("• Mostrar a cada cuenta únicamente la información que su rol necesita."),
  paragraph("• Tratar los datos personales conforme a la Ley Orgánica de Protección de Datos Personales y a lo descrito en el Capítulo VIII."),
  paragraph("• Revisar los pagos que se registren, emitir el recibo cuando los valide y responder por sus canales de contacto las consultas, los errores de pago y las solicitudes de devolución."),
  paragraph("• Registrar el documento y la versión aceptada por el usuario, junto con la fecha de aceptación y la cuenta asociada. La aceptación deberá ser realizada directamente por el usuario y no por el sistema en su nombre."),
  paragraph("• Respetar los derechos que la ley le reconoce como titular de datos personales y como consumidor, y actuar siempre según el interés superior del niño, niña o adolescente."),

  heading("Capítulo III. Cómo se usa la plataforma"),
  heading("Su cuenta"),
  paragraph("Para usar la plataforma necesita una cuenta. Cada cuenta tiene un rol (por ejemplo, representante, entrenador o administrador) y solo ve la información que ese rol necesita."),
  heading("Menores y representantes"),
  paragraph("Si el jugador es menor de 18 años, su cuenta debe estar vinculada a un representante legal. El representante es quien registra al jugador, acepta estos términos en su nombre y administra su información y sus pagos y, mientras el jugador sea menor de 15 años, sus consentimientos. El jugador de 15 a 17 años da y retira sus propios consentimientos, y su representante es informado."),
  paragraph("Podemos pedirle un documento que acredite quién es el representante. Si el jugador tiene de 15 a 17 años, también respetamos su derecho a opinar y a decidir sobre el uso de su imagen y de sus datos, conforme al Capítulo VIII y al Permiso de uso de imagen. En todos los casos, el interés del niño, niña o adolescente es lo primero."),
  heading("Membresías, pagos, comprobantes y recibos"),
  paragraph("Los precios, las formas de pago y los datos para pagar le son comunicados por el club a través de sus canales de contacto."),
  paragraph("Cuando usted pague, suba en la plataforma su comprobante: es el documento que usted presenta como prueba de su pago (por ejemplo, la foto o captura de una transferencia). Un pago aparece como «Por validar» hasta que una persona del club lo revise. Mientras esté «Por validar», no se considera confirmado."),
  paragraph("El recibo es el documento que emite el club para confirmar que recibió y validó su pago. Solo el recibo del club prueba que el pago fue recibido y validado; el comprobante no lo reemplaza. El recibo es un documento interno del club: no es una factura ni un comprobante de venta tributario."),
  paragraph("Si hay un error de pago, un cobro repetido o si desea solicitar una devolución, escríbanos a cataclub.loja@proton.me o por WhatsApp. El club revisa cada caso y le responde por esos mismos canales. Estos términos no limitan los derechos que la ley le reconoce como consumidor."),
  heading("Cambios de estos términos y nuevas versiones"),
  paragraph("El club puede actualizar estos términos con una nueva versión. Se la mostraremos en su siguiente inicio de sesión; hasta que la acepte, solo podrá revisar los documentos o cerrar sesión."),

  heading("Capítulo IV. Compromisos y responsabilidades de la persona usuaria"),
  paragraph("Al usar la plataforma, usted se compromete a:"),
  paragraph("• Dar datos verdaderos, completos y actualizados."),
  paragraph("• Cuidar su contraseña, no compartir su cuenta con otras personas y avisarnos de inmediato si cree que alguien entró a su cuenta sin permiso."),
  paragraph("• Si es representante, actuar en beneficio del jugador menor de edad y mantener al día su información y sus pagos y, si el jugador es menor de 15 años, sus consentimientos."),
  paragraph("• Usar la plataforma solo para asuntos del club."),
  paragraph("No está permitido:"),
  paragraph("• Dar información falsa a propósito."),
  paragraph("• Entrar a cuentas de otras personas."),
  paragraph("• Intentar eludir los controles de seguridad."),
  paragraph("• Subir archivos ilícitos, dañinos o que no correspondan (por ejemplo, un comprobante falso)."),
  paragraph("• Afectar el funcionamiento del servicio o la privacidad de otras personas."),

  heading("Capítulo V. Seguridad y suspensión"),
  paragraph("El club puede limitar funciones o suspender una cuenta si hay indicios de uso indebido, de riesgo para otras cuentas o de necesidad de proteger el servicio. Cuando lo haga, le explicará el motivo por los canales de contacto y la medida será proporcional a la situación."),

  heading("Capítulo VI. Aceptación obligatoria, retiro y cierre de su cuenta"),
  paragraph("Para crear una cuenta es obligatorio aceptar, en conjunto, estos términos, el Consentimiento para el tratamiento de datos de salud y el Permiso de uso de imagen. Si no los acepta, no se crea la cuenta."),
  paragraph("Usted puede retirar cualquiera de ellos en cualquier momento, por la plataforma o escribiendo a cataclub.loja@proton.me, e indicar el motivo si lo desea. El retiro vale desde ese momento hacia adelante. Como estos documentos son condición para usar el servicio, mientras uno de ellos esté retirado su cuenta quedará limitada a revisar los documentos y cerrar sesión, igual que cuando hay una nueva versión pendiente de aceptar (Capítulo III)."),
  paragraph("También puede pedir el cierre de su cuenta. Sus datos se tratan entonces según el Capítulo VIII."),

  heading("Capítulo VII. Responsabilidad"),
  paragraph("El club no garantiza que la plataforma esté libre de interrupciones o errores. El club no se hace responsable de los daños que se deriven de datos falsos, del uso de su cuenta por otra persona por descuido suyo o de causas fuera de su control razonable, en la medida que la ley lo permita."),

  heading("Capítulo VIII. Protección de datos personales (Aviso de privacidad)", PRIVACY_CHAPTER_ID),
  heading("Propósito y alcance"),
  paragraph("Este capítulo regula el tratamiento de datos personales por Cata Club. Aplica a representantes, jugadores, entrenadores y administradores que usan la plataforma, y se basa en la Ley Orgánica de Protección de Datos Personales del Ecuador."),
  heading("Quién es el responsable"),
  paragraph("La responsable del tratamiento es Lucía Catalina Cedillo Flor, identificada en el Capítulo I, propietaria de Cata Club. Correo para asuntos de datos personales: cataclub.loja@proton.me. WhatsApp: 0994219619 y 0990288152."),
  heading("Qué datos recogemos"),
  paragraph("• Identidad y contacto: nombres y apellidos, número de cédula, fecha de nacimiento, fotografía de perfil, teléfonos, dirección y correo."),
  paragraph("• Representación: si el jugador es menor de edad, el vínculo con su representante legal, que es obligatorio."),
  paragraph("• Ficha médica (datos de salud): tipo de sangre, alergias, enfermedades, contacto de emergencia y su teléfono. Estos datos se tratan con un consentimiento aparte (ver «Consentimiento para el tratamiento de datos de salud»)."),
  paragraph("• Actividad deportiva: membresías, asistencia y fotografías de la galería del club."),
  paragraph("• Pagos: los pagos registrados, los comprobantes que sube la familia y los recibos que emite el club."),
  paragraph("• Reportes de error: si usted decide enviar un reporte, guardamos su descripción, la ruta de la plataforma donde ocurrió y los datos de su navegador (user-agent). Puede adjuntar una captura de pantalla, que solo se guarda si usted da un consentimiento aparte para eso."),
  paragraph("• Datos técnicos y de seguridad: las sesiones guardan el dispositivo desde el que usted inició sesión, no su dirección IP. Para frenar intentos repetidos de acceso, el sistema usa temporalmente la dirección IP."),
  paragraph("• Aceptaciones: para cada documento que usted acepta, guardamos la versión, la fecha y su cuenta; y, si lo retira, la fecha y el motivo."),
  paragraph("Los datos de menores de edad y los datos de salud son categorías especiales: los tratamos con más cuidado. Para los fines que se basan en consentimiento (salud, imagen y comunicaciones) requerimos autorización expresa, que usted otorga al aceptar en conjunto estos términos, el Consentimiento para el tratamiento de datos de salud y el Permiso de uso de imagen al crear la cuenta; el manejo de la cuenta, las membresías y los pagos se basa en la relación con el club. Nunca pedimos más datos de los necesarios."),
  heading("Para qué usamos sus datos y con qué base"),
  paragraph("• Crear y proteger su cuenta, y darle acceso a la plataforma. Base: la relación con el club y su consentimiento a estos términos."),
  paragraph("• Registrar jugadores, membresías y asistencia, y coordinar los entrenamientos. Base: la relación con el club."),
  paragraph("• Registrar y validar pagos, y emitir los recibos internos del club. Base: la relación con el club."),
  paragraph("• Atender una emergencia médica de un jugador usando su ficha médica. Base: su consentimiento de datos de salud."),
  paragraph("• Publicar fotografías en la galería, en redes sociales o enviarlas a la FETM. Base: su Permiso de uso de imagen."),
  paragraph("• Mantener la seguridad, detectar errores y poder demostrar qué aceptó usted y cuándo. Base: interés legítimo del club y obligaciones legales."),
  paragraph("No usamos sus datos para otras finalidades sin su autorización previa. No vendemos sus datos. No tomamos decisiones únicamente automatizadas sobre usted."),
  heading("Quién puede ver sus datos"),
  paragraph("• Ficha médica: el administrador del club y el representante del jugador. El entrenador no la ve de manera normal: solo puede consultarla en una emergencia, a través de una vía especial, y cada consulta queda registrada para auditoría."),
  paragraph("• Reportes de error: solo el administrador."),
  paragraph("• Datos de cuenta y de jugadores: cada persona ve lo suyo y lo de los jugadores que representa. El personal del club ve solo lo que su función necesita."),
  heading("Proveedores que tratan datos por cuenta del club"),
  paragraph("El club usa estos proveedores, que tratan datos solo para prestarle el servicio:"),
  paragraph("• DigitalOcean: aloja el servidor de la plataforma. El proveedor es responsable de la seguridad física de la infraestructura que presta."),
  paragraph("• Cloudinary: almacena los recibos, los comprobantes y las fotografías de perfil como archivos protegidos: solo se abren con un enlace firmado que vence a los 15 minutos."),
  paragraph("• Proveedor de correo electrónico: envía los correos de la plataforma, como los de verificación."),
  paragraph("• WhatsApp: la plataforma solo genera enlaces para que usted abra una conversación en WhatsApp; no usa ninguna conexión automática con WhatsApp ni le envía sus datos."),
  paragraph("Estos proveedores pueden tener sus servidores fuera del Ecuador, incluidos los Estados Unidos. Cuando sus datos salen del país, el club los envía solo a proveedores que ofrezcan garantías adecuadas de protección y, si hace falta, con su consentimiento. Todo proveedor que trate datos por cuenta del club lo hace bajo un contrato y bajo sus instrucciones."),
  heading("Cookies y almacenamiento en su navegador"),
  paragraph("La plataforma usa solo lo indispensable: cookies de sesión protegidas, una cookie para el proceso de inscripción, y preferencias guardadas en el navegador. No usamos analítica ni publicidad, por eso no le mostramos un aviso de cookies."),
  heading("Cuánto tiempo conservamos sus datos"),
  paragraph("Conservamos sus datos mientras tenga una cuenta o los necesitemos para el fin descrito. Mantenemos copias de respaldo diarias, que se renuevan de manera rotativa (aproximadamente cada 14 días); por eso un dato que eliminemos puede permanecer en un respaldo hasta que este se reemplace."),
  paragraph("Si usted pide eliminar su cuenta, el club revisa su solicitud, la aprueba una persona administradora y espera 30 días antes de eliminar, por si usted cambia de opinión. Después:"),
  paragraph("• Se eliminan: sus datos de identidad, la ficha médica, los recibos y comprobantes, y las fotografías."),
  paragraph("• Se conservan, sin identificarle: los pagos, las membresías y la asistencia, para la contabilidad y las estadísticas del club."),
  paragraph("• Se conservan: los registros de lo que usted aceptó y retiró, para poder demostrarlo."),
  paragraph("Si usted es representante de jugadores menores de edad, no podemos eliminar su cuenta mientras ellos sigan a su cargo; primero debe resolverse su situación."),
  heading("Sus derechos"),
  paragraph("Como titular de sus datos, usted puede, de forma gratuita:"),
  paragraph("• Acceder a sus datos y saber cómo los tratamos."),
  paragraph("• Rectificarlos si están incorrectos o incompletos."),
  paragraph("• Eliminarlos, en los casos que la ley permite."),
  paragraph("• Oponerse a un tratamiento o pedir que se suspenda."),
  paragraph("• Pedir portabilidad: recibir sus datos en un formato estructurado y de uso común. Si la pide, el club la atiende por correo."),
  paragraph("• Retirar su consentimiento cuando el tratamiento se base en él. El retiro vale hacia adelante y no afecta lo que se hizo antes."),
  paragraph("Para ejercer un derecho, escriba a cataclub.loja@proton.me con su nombre y lo que necesita. Le responderemos en un máximo de 15 días. Si no recibe respuesta o no está de acuerdo, puede presentar un reclamo ante la Superintendencia de Protección de Datos Personales."),
  heading("Menores y representantes en materia de datos"),
  paragraph("Menores de 15 años: su representante legal da las autorizaciones y recibe esta información en su nombre. Adolescentes de 15 a 17 años: ellos mismos pueden dar su autorización y ejercer sus derechos de manera directa; su representante también es informado. En ningún caso un representante puede retirar una autorización que dio el propio adolescente."),
  paragraph("El jugador adolescente puede pedir que se le explique el contenido de este capítulo."),
  heading("Seguridad e incidentes"),
  paragraph("Protegemos los datos con medidas técnicas y organizativas: acceso por roles, sesiones protegidas, archivos privados con enlaces que vencen, copias de respaldo y registro de las consultas a la ficha médica."),
  paragraph("Si ocurre una violación de seguridad que afecte sus datos, el club la notificará a la Superintendencia de Protección de Datos Personales dentro de 5 días y, cuando exista un riesgo para sus derechos, le avisará a usted dentro de 3 días (Arts. 43 y 46 de la Ley Orgánica de Protección de Datos Personales)."),
  heading("Cambios de este capítulo"),
  paragraph("Podemos actualizar este capítulo mediante una nueva versión de estos términos, que se le mostrará para que usted la acepte según el Capítulo III."),

  heading("Capítulo IX. Ley aplicable y contacto"),
  paragraph("Estos términos se rigen por las leyes de la República del Ecuador. Para consultas sobre ellos, escriba a cataclub.loja@proton.me."),

  heading("Capítulo X. Consentimiento para el tratamiento de datos de salud", HEALTH_CHAPTER_ID),
  ...healthChapter,

  heading("Capítulo XI. Permiso de uso de imagen", IMAGE_CHAPTER_ID),
  ...imageChapter,
];

/** Key points of the document above, for the side summary. Nothing here goes beyond the text. */
export const summary: readonly string[] = [
  "La responsable es Lucía Catalina Cedillo Flor, propietaria de Cata Club; puede escribirle a cataclub.loja@proton.me.",
  "Solo el recibo del club prueba que un pago fue recibido y validado; el comprobante que usted sube no lo reemplaza.",
  "Para crear una cuenta debe aceptar este documento, que incluye el consentimiento de datos de salud (Capítulo X) y el permiso de uso de imagen (Capítulo XI); puede retirarlos después, y el retiro vale hacia adelante.",
  "El aviso de privacidad es el Capítulo VIII: qué datos recogemos, para qué, quién los ve y cuánto tiempo se conservan.",
  "Cada aceptación guarda la versión, la fecha y su cuenta; nunca se acepta en su nombre.",
];
