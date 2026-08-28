import { heading, paragraph, type LegalBlock } from "./legal-content";

export const legalBlocks: readonly LegalBlock[] = [
  heading("Objetivo y alcance"),
  paragraph("El servicio podrá incluir registro y acceso de usuarios, gestión de perfiles, asociación de alumnos, consulta de horarios y asistencia, carga o consulta de comprobantes, y comunicaciones operativas. El alcance exacto de cada módulo queda sujeto a la configuración vigente del servicio."),
  heading("Cuenta y responsabilidades"),
  paragraph("La persona titular de una cuenta debe proporcionar datos verdaderos, completos y actualizados, proteger sus credenciales y avisar oportunamente si sospecha un acceso no autorizado. La cuenta no debe compartirse cuando ello comprometa la seguridad o la trazabilidad."),
  heading("Uso aceptable"),
  paragraph("La plataforma debe utilizarse para fines relacionados con la actividad del club. No se permite introducir información falsa deliberadamente, acceder a cuentas ajenas, intentar eludir controles de seguridad, cargar contenido ilícito o malicioso, ni interferir con la disponibilidad del servicio o con la privacidad de otras personas."),
  heading("Pagos y comprobantes"),
  paragraph("Cuando el servicio habilite pagos o carga de comprobantes, la persona usuaria debe registrar información suficiente para identificar la operación y conservar sus comprobantes. Los estados visibles en la plataforma reflejan una gestión operativa y pueden requerir revisión administrativa."),
  paragraph("Los precios, medios de pago, comprobantes y condiciones específicas se comunicarán por los canales definidos por Cata Club."),
  heading("Seguridad, suspensión y cambios"),
  paragraph("Cata Club podrá aplicar medidas operativas de seguridad, limitar temporalmente funciones o suspender una cuenta cuando existan indicios de uso indebido, riesgo para otras cuentas o necesidad de proteger el servicio. La medida y su comunicación deberán ser proporcionales a la situación y documentadas administrativamente."),
  paragraph("Estos términos podrán actualizarse mediante una nueva versión. Cada aceptación debe conservar el documento o versión aceptada, fecha y hora, cuenta y, cuando corresponda, la persona representante. Las cuentas existentes deberán aceptar la nueva versión en el siguiente inicio de sesión; hasta hacerlo, solo podrán revisar los documentos o cerrar sesión. Nunca se autoaceptará en nombre de la persona usuaria."),
  heading("Contacto y revocación"),
  paragraph("Las consultas sobre estos documentos y las solicitudes de revocación se recibirán en cataclub.loja@proton.me. La revocación se tramitará prospectivamente y de forma administrativa; no implica promesa de eliminación automática de datos ni desconoce posibles necesidades operativas o legales de conservación."),
  heading("Interacción de aceptación agrupada"),
  paragraph("Antes de continuar, la interfaz debe mostrar una única casilla inicialmente desmarcada y bloqueante:"),
  paragraph("[ ] Acepto los Términos de uso, el Aviso de privacidad, el tratamiento de datos médicos y la difusión pública de imagen conforme al documento de Permiso público de difusión de imagen FETM."),
  paragraph("La aceptación agrupada debe registrar por separado cada documento o versión cubierta, timestamp, cuenta y representante cuando aplique. No debe activarse por defecto ni permitir continuar sin una acción afirmativa."),
];
