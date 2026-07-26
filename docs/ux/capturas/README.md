# Capturas de la interfaz — Cata Club

Galería visual del rediseño. Capturas tomadas contra el servidor de desarrollo en
`http://localhost:3300` con Playwright, en modo página completa (`fullPage`).

- **Escritorio**: viewport de 1440 × 900 px (el ancho útil de la imagen es 1425 px,
  el resto lo ocupa la barra de desplazamiento).
- **Móvil**: viewport de 390 × 844 px (ancho útil de 375 px).

Cuentas usadas: `admin@cataclub.com` (administrador), `entrenador@cataclub.com`
(entrenador) y `ana@cataclub.com` (estudiante). No se modificó ningún dato: los
formularios de validación de pagos y de toma de asistencia se abrieron pero nunca
se enviaron.

> **Nota sobre los elementos fijos**: en una captura de página completa, las barras
> con posición fija (la barra de navegación inferior en móvil, la barra de acciones
> del asistente de asistencia y la barra lateral del panel) se dibujan a la altura
> del viewport y no al final del documento. Por eso aparecen superpuestas a mitad de
> la imagen. Es un artefacto de la captura, no del diseño.

## Escritorio (1440 × 900)

| Archivo | Pantalla |
| --- | --- |
| `desktop-landing.png` | Página pública de inicio (`/`), sin sesión. Cabecera con navegación e ingreso, portada roja con el lema y la foto del club, franja de cifras (2013 · Loja), bloques de misión y visión, valores, llamada a inscripción, galería, tarjetas de horarios por categoría, mapa con datos de contacto y pie de página. |
| `desktop-login.png` | Formulario de acceso (`/login`). Tarjeta centrada con campos de correo y contraseña, enlace de recuperación, botón primario rojo, enlace de registro y nota sobre el manejo de la sesión mediante cookie segura. |
| `desktop-enroll.png` | Asistente de inscripción (`/student/enroll`) sin sesión iniciada. Paso 1 de 5 con indicador de pasos (Tipo · Estudiante · Contacto · Salud · Confirmar) y elección entre inscribirse como jugador o como representante. Incluye el panel de datos de prueba visible solo en desarrollo. |
| `desktop-dashboard.png` | Panel administrativo (`/dashboard`). Aviso destacado con los pagos por validar, tarjetas de miembros, membresías activas y asistencia de 4 semanas, lista de actividad reciente y gráfico de anillo con la distribución de asistencias. |
| `desktop-members.png` | Listado de miembros (`/members`). Cuatro tarjetas de resumen, buscador, filtros por estado (Todos, Membresía vencida, Pago pendiente, Sin grupo asignado), tabla de responsables de pago con contacto, número de estudiantes y estado de membresía, y paginación. |
| `desktop-payments.png` | Cola de validación de pagos (`/payments`). Pestañas por estado (Pendientes, Validados, Rechazados, Todas) con conteo, buscador de estudiante y tabla con período, monto, método, estado y acción "Revisar", paginada de a 10. |
| `desktop-payments-detalle.png` | Detalle de una solicitud de pago, abierto desde "Revisar". Ficha con los datos de la solicitud, visor del comprobante con opciones de ampliar y descargar, lista de verificación de tres puntos previa a la aprobación y bloque de decisión con el botón de aprobar deshabilitado hasta completar la lista. Navegación entre solicitudes pendientes en la parte superior. |
| `desktop-attendance.png` | Registro de asistencias (`/attendance`). Tarjetas de horarios, registros, presentes y ausencias/tardanzas; selector de rango de fechas, filtros por horario y por alumno, y tabla de registros con fecha, horario, estudiante, estado y quién registró. |
| `desktop-groups.png` | Horarios de entrenamiento (`/groups`). Filtros por día y cuadrícula de tarjetas, una por horario, con entrenador, categoría, número de inscriptos y acciones de ver alumnos y editar. |
| `desktop-ranking.png` | Escalera de niveles (`/ranking`). Tarjetas con estudiantes asignados y cantidad de niveles, y lista ordenada de niveles con la posición, los avatares de los estudiantes asignados y el botón de asignar. |
| `desktop-reports.png` | Generador de reportes (`/reports`). Tres tarjetas de tipo de reporte (período, asistencia, pagos), selector de rango de fechas con botón de generar PDF y panel de vista previa con el estado vacío. |
| `desktop-profile.png` | Perfil de la cuenta (`/profile`). Tarjeta de identidad con avatar y rol, bloque de datos personales y bloque de seguridad con cambio de contraseña y cierre de sesión. |
| `desktop-trainer.png` | Panel del entrenador (`/trainer`). Tarjeta destacada con la próxima sesión y acceso directo a pasar lista, y resumen de la última lista tomada con el conteo por estado y un aviso de ausencias acumuladas. |
| `desktop-trainer-lista.png` | Asistente de toma de asistencia (`/trainer/attendance`), paso 1. Indicador de tres pasos y selección del día de entrenamiento; el botón de continuar permanece deshabilitado hasta elegir un horario. |
| `desktop-trainer-lista-paso2.png` | Asistente de toma de asistencia, paso 2. Contador de presentes sobre el total, acción de marcar a los restantes como presentes, leyenda de los cuatro estados, filtro por nombre y listado de alumnos con botones de estado. Paginado de a 10 con barra de acciones fija al pie. |
| `desktop-student.png` | Área del estudiante (`/student`). Carnet de socio oscuro con nombre, nivel y estado de membresía, tarjeta del próximo entrenamiento, resumen de la mensualidad y listado de asistencia reciente. |

## Móvil (390 × 844)

| Archivo | Pantalla |
| --- | --- |
| `mobile-landing.png` | Página pública de inicio en una sola columna: portada, cifras apiladas, misión y visión, valores, galería, horarios, ubicación y pie de página. |
| `mobile-dashboard.png` | Panel administrativo adaptado a móvil. La barra lateral se reemplaza por una barra de navegación inferior con Panel, Miembros, Pagos y Más; las tarjetas y la actividad reciente se apilan verticalmente. |
| `mobile-payments.png` | Cola de pagos en móvil. La tabla se convierte en tarjetas por solicitud, cada una con estudiante, responsable de pago, período, método, monto y botón "Revisar". |
| `mobile-members.png` | Listado de miembros en móvil. Tarjetas de resumen apiladas, buscador, filtros por estado y fichas por responsable de pago con teléfono, cantidad de estudiantes y estado de membresía. |
| `mobile-trainer-lista-paso2.png` | Paso 2 del asistente de asistencia en móvil. Cada alumno ocupa una ficha con los cuatro botones de estado en fila, precedida por el contador de presentes y el filtro por nombre. |
| `mobile-student.png` | Área del estudiante en móvil. Carnet de socio, próximo entrenamiento, mensualidad y asistencia reciente, todo en una columna, con acceso al menú desde la cabecera. |
