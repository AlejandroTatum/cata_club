# Guía de implementación de mockups

> **Nota (obsoleta):** la excepción de `/student` respecto de `AppShell` descrita en este documento quedó obsoleta — `/student` ahora usa `AppShell` igual que el resto de las pantallas autenticadas (ver `src/app/student/page.tsx` y `src/components/shell/AppShell.tsx`). El resto de la guía (wizard de inscripción, validaciones, modelo de datos) sigue vigente.

Esta guía permite implementar los 11 mockups HTML de `design/` sobre la aplicación Next.js existente sin cambiar el modelo de dominio, los permisos ni el flujo de inscripción de estudiante que está en desarrollo. Los mockups son especificaciones de interfaz e interacción, no código para copiar: se deben traducir a componentes React, rutas existentes, datos tipados y clases Tailwind.

## Camino recomendado

1. Implementar primero la estructura visual compartida de las pantallas administrativas y de entrenador, respetando la navegación determinada por rol.
2. Adaptar cada ruta existente al mockup correspondiente, conservando sus datos, acciones, validaciones y protección de acceso.
3. Tratar `src/app/student/` como una excepción: mantener su estructura y comportamiento actuales; usar su mockup solo para ajustes visuales que no alteren el flujo.
4. Verificar cada pantalla con sus estados de carga, vacío y error, y ejecutar los comandos de verificación al final de esta guía.

## Jerarquía de fuentes de verdad

| Prioridad | Fuente | Regla |
|---|---|---|
| 1 | Código actual, cambios locales incluidos, para `src/app/student/` | Es la autoridad para estructura, datos, permisos, navegación y comportamiento. El mockup de estudiante no puede sustituirla. |
| 2 | Mockup HTML correspondiente, para todas las demás pantallas | Es la autoridad visual y funcional: jerarquía, distribución, controles, estados visibles e interacciones descritas en HTML/JavaScript. |
| 3 | Arquitectura y contratos existentes | Rutas, roles, `ProtectedRoute`, tipos, servicios, mocks y pruebas no se reemplazan por HTML estático. Se adaptan a la interfaz del mockup. |
| 4 | Convenciones del repositorio | Next.js App Router, TypeScript estricto, Tailwind y accesibilidad delimitan la implementación. |

Una diferencia menor se resuelve así: conservar el contrato de código y aplicar el resultado visual del mockup. Ejemplo: si el mockup usa datos estáticos, mostrar los datos reales/mock tipados de la ruta con la misma composición visual.

Una contradicción crítica requiere detenerse y pedir decisión al responsable antes de codificar. Es crítica si obliga a cambiar una ruta, un rol permitido, el modelo `Persona`/representante-estudiante, la persistencia, una acción de pago o el flujo de inscripción. No se debe resolver por intuición ni copiando el HTML.

## Inventario y mapeo

| Mockup | Ruta y archivo de implementación | Rol y alcance | Interacciones a trasladar |
|---|---|---|---|
| `admin-login-mockup-v1.html` | `/login` — `src/app/login/page.tsx` | Pública | Inicio de sesión, visibilidad de contraseña, enlace a recuperación y registro. El redireccionamiento posterior debe continuar usando `getDefaultRoute`. |
| `admin-register-mockup-v1.html` | `/register` — `src/app/register/page.tsx` | Pública | Formulario, confirmación de contraseña, validación visible, estado de envío y enlaces de acceso. |
| `admin-forgot-password-mockup-v1.html` | `/forgot-password` — `src/app/forgot-password/page.tsx` | Pública | Pantalla de recuperación/estado «Próximamente» y retorno a acceso. No inventar envío de correo si no existe un contrato. |
| `admin-panel-mockup-v1.html` | `/dashboard` — `src/app/dashboard/page.tsx` | Solo `admin` | Panel, métricas, acciones rápidas, actividad reciente, pagos por revisar y buscador/comando visual si se implementa. |
| `admin-members-mockup-v1.html` | `/members` — `src/app/members/page.tsx` | Solo `admin` | Resumen, búsqueda, filtros, expansión de cuenta, detalle de estudiantes y acciones por fila. Usar `MemberAccount` y utilidades de `members-utils.ts`. |
| `admin-groups-mockup-v1.html` | `/groups` — `src/app/groups/page.tsx` | Solo `admin` | Horarios, grupos expandibles, asignar/remover estudiantes y notificaciones. Conservar las reglas de `groups-utils.ts` y los datos canónicos de mocks. |
| `admin-payments-mockup-v1.html` | `/payments` — `src/app/payments/page.tsx` | Solo `admin` | Filtros, listado, detalle, comprobante, aprobar/rechazar y motivo obligatorio de rechazo. Conservar `fetchPaymentValidations`, `updatePaymentValidation`, `ConfirmDialog` y sus estados. |
| `admin-attendance-mockup-v1.html` | `/attendance` — `src/app/attendance/page.tsx` | Solo `admin` | Resumen, filtros de asistencia, registros recientes, horarios y vista de tendencia. Usar estados y etiquetas de `attendance-utils.ts`; el nivel pertenece al grupo, no al horario. |
| `admin-trainer-mockup-v1.html` | `/trainer` — `src/app/trainer/page.tsx` | Solo `trainer` | Panel de entrenador, sesiones del día y enlaces a registrar asistencia. Las sesiones se derivan de grupos, horarios y estudiantes, no se duplican como datos visuales. |
| `admin-trainer-attendance-mockup-v1.html` | `/trainer/attendance` — `src/app/trainer/attendance/page.tsx` | Solo `trainer` | Wizard de seleccionar sesión, marcar asistencia, revisar/confirmar y reiniciar. Mantener los estados `present`, `absent`, `late`, `justified` y el flujo existente. |
| `admin-student-mockup-v1.html` | `/student` — `src/app/student/page.tsx`; inscripción en `/student/enroll` — `src/app/student/enroll/page.tsx` | `representante` y `estudiante` | Excepción obligatoria descrita en la siguiente sección. |

No hay mockup asignado a `/`, `/products` ni a las rutas API. No deben rediseñarse como parte de esta tarea salvo una necesidad explícita y aprobada.

## Regla especial: estudiante

El mockup `admin-student-mockup-v1.html` es una referencia visual secundaria, nunca una especificación de estructura o comportamiento.

Se debe preservar lo siguiente:

- La protección de `/student` y `/student/enroll` para `representante` y `estudiante` mediante `ProtectedRoute`.
- El portal actual de `src/app/student/page.tsx`, incluidos sus escenarios de membresía/pago, selección de estudiante representado, sesiones próximas y vista previa a inscripción.
- El wizard actual de cinco pasos de `src/app/student/enroll/page.tsx`: `type`, `personal`, `club`, `health`, `summary`.
- La distinción entre inscripción propia (`self`) y de dependiente (`child`) de `EnrollmentType`.
- Las validaciones de `src/app/student/enroll/enroll-utils.ts` y la creación de personas: primero representante cuando corresponde y luego estudiante con `representante_id`.
- Los cambios locales no confirmados en `src/app/student/enroll/`, `src/services/api.ts`, `src/services/mockStore.ts`, `src/types/domain.ts`, `src/lib/persona-adapter.ts` y sus pruebas. Son parte del estado fuente actual, aunque no estén confirmados en Git.

Se pueden tomar del mockup de estudiante colores, espaciado, tarjetas, jerarquía tipográfica, tratamiento responsivo y presentación de comprobantes, siempre que no se elimine ni simplifique el portal/wizard vigente. Si una propuesta visual exige sustituir la selección de representados, el wizard, las validaciones o la persistencia, se debe detener la implementación y solicitar decisión.

## Arquitectura que se debe preservar

### Rutas, autenticación y roles

- El layout raíz está en `src/app/layout.tsx`; contiene `AuthProviderWrapper`, `Header` y el contenedor principal. No duplicar proveedores ni crear un layout paralelo sin necesidad.
- La sesión se gestiona en `src/contexts/AuthContext.tsx` y se hidrata desde almacenamiento local. Durante esa hidratación debe mantenerse una interfaz de carga, no contenido protegido transitorio.
- `src/components/ProtectedRoute.tsx` protege las pantallas en cliente: sin sesión redirige a `/login`; con rol incorrecto redirige a la ruta predeterminada del rol.
- `src/lib/auth-utils.ts` es la fuente central de navegación y redirección: `admin` va a `/dashboard`, `trainer` a `/trainer`, y `representante`/`estudiante` a `/student`.
- La navegación visible se deriva de `getNavGroupsForRoles`. Una barra lateral o encabezado inspirado en los mockups debe seguir mostrando únicamente los enlaces autorizados para los roles que la cuenta tiene — todos ellos, agrupados por sección (D12d), no solo el rol primario. No mostrar accesos administrativos a quien no es administrador.
- Las rutas administrativas conservan `allowedRoles={["admin"]}`; las de entrenador, `allowedRoles={["trainer"]}`; las de estudiante, `allowedRoles={["representante", "estudiante"]}`.

### Datos y dominio

- Reutilizar los contratos existentes en `src/types/domain.ts`, `src/services/api.ts` y `src/mocks/`; no crear un segundo modelo basado en nombres o valores del HTML.
- Para miembros, usar `src/app/members/members-utils.ts` y `src/mocks/members.ts`.
- Para horarios y asistencia, usar `src/app/attendance/attendance-utils.ts` y `src/mocks/attendance.ts`.
- Para sesiones de entrenador, conservar la derivación desde grupos, horarios y estudiantes en `src/app/trainer/attendance/attendance-utils.ts` y `src/lib/groups-utils.ts`.
- Los valores de ejemplo del mockup no crean reglas de negocio. En particular, no inventar horarios, canchas, niveles, importes ni cantidades para satisfacer la maqueta.

### Componentes y estado

- Extraer componentes reutilizables solo cuando una pieza tenga una responsabilidad clara y se use en más de una pantalla. Mantener las props en interfaces llamadas `{NombreComponente}Props`.
- Conservar las utilidades puras existentes; agregar pruebas conductuales cuando se agregue lógica nueva.
- Traducir `onclick` y JavaScript de los HTML a controladores React tipados. No incrustar scripts ni usar manipulación directa del DOM para reproducir los mockups.
- La estructura compartida de navegación puede evolucionar visualmente para parecerse a las maquetas, pero debe seguir siendo una única implementación reutilizable y consciente del rol. La experiencia de estudiante no puede perder su estructura actual por un cambio compartido.

## Reglas de implementación

### Next.js y React

- Mantener Server Components como predeterminados. Declarar `"use client"` solo en los componentes que requieran estado, efectos, eventos, almacenamiento local o APIs del navegador.
- No importar servicios solo de servidor, secretos o acceso a entorno en componentes cliente.
- No modificar rutas API por motivos puramente visuales. Si se toca un handler por una necesidad real, validar método, autenticación y cuerpo antes de actuar.
- Usar `next/link` para navegación interna y `next/image` cuando se incorporen imágenes gestionadas por Next.js.

### TypeScript estricto

- Tipar explícitamente props, funciones y retornos; no usar `any`. En límites externos usar `unknown` y validar antes de consumir.
- No usar aserciones no nulas sin una justificación concreta en comentario.
- Reutilizar tipos del dominio y definir interfaces planas para nuevas estructuras de UI; no duplicar tipos del backend ni del mockup.

### Tailwind y sistema visual

- Implementar los estilos con utilidades Tailwind y los tokens/clases Cata Club ya existentes; no copiar el bloque `<style>` de los HTML ni introducir CSS en línea salvo valores verdaderamente dinámicos.
- El lenguaje visual de los mockups incluye fondo claro, superficies blancas, bordes sutiles, rojo Cata como acción principal, fucsia/amarillo como acentos y estados distinguibles. Aplicarlo sin cambiar contratos funcionales.
- La interfaz debe responder en móvil: navegación colapsable accesible, tablas con alternativa de desborde/lectura y controles táctiles utilizables. No ocultar acciones esenciales solo para ajustar el diseño.

### Accesibilidad y estados

- Cada input necesita `label` asociado; los botones solo con icono requieren `aria-label`; el menú y los acordeones necesitan `aria-expanded` y controles asociados cuando aplique.
- Los filtros activos deben comunicar su estado además del color. Los estados de asistencia y pago deben conservar texto e icono, no solo color.
- Mostrar estados explícitos de carga, vacío y error en cada pantalla que consulta o transforma datos. Las rutas no tienen actualmente archivos `loading.tsx` ni `error.tsx`; los estados locales deben conservarse y, si se introducen límites de ruta, hacerlo de forma deliberada y consistente.
- No exponer mensajes técnicos, tokens, identificadores internos ni trazas en la interfaz.
- Deshabilitar acciones mientras se envían, prevenir duplicados y anunciar errores de formulario con texto comprensible y `role="alert"` cuando corresponda.

## Flujo incremental

1. Revisar `git status --short` antes de editar. No revertir ni formatear los cambios locales de estudiante u otros cambios ajenos.
2. Preparar primero primitivas visuales compartidas que respeten el layout actual: navegación por rol, encabezado de página, tarjetas, badges, filtros y contenedores de tabla/detalle.
3. Implementar las pantallas públicas: acceso, registro y recuperación. Validar enlaces y redireccionamiento por rol.
4. Implementar las rutas de administrador una por una: dashboard, miembros, grupos, pagos y asistencia. Mantener en cada una sus datos, permisos y estados existentes.
5. Implementar las rutas de entrenador: panel y wizard de asistencia. Comprobar que las sesiones y la lista de estudiantes siguen derivándose de los datos canónicos.
6. Aplicar ajustes visuales compatibles en estudiante al final. Antes de cada cambio en `src/app/student/`, revisar que no cambien los cinco pasos, los DTO, las validaciones ni la relación representante-estudiante.
7. Añadir o actualizar pruebas solo para lógica o comportamiento nuevo. Ejecutar verificaciones y realizar revisión visual en escritorio y móvil.

## Manejo de contradicciones

| Situación | Acción |
|---|---|
| El mockup propone otra disposición visual, pero la ruta ya obtiene los datos correctos | Conservar datos y acción actuales; aplicar la disposición del mockup. |
| El mockup contiene valores de demostración distintos de los mocks o datos actuales | Mantener los datos tipados actuales y replicar solo el diseño. |
| El mockup contiene una acción sin servicio o contrato existente | Construir primero la UI solo si puede tener un estado honesto no operativo; para persistencia, pagos, cambio de rol o correo, pedir definición antes de inventar un contrato. |
| El mockup y código difieren en una etiqueta menor | Usar terminología actual `estudiante`; `ALUMNO` solo puede aparecer si se documenta el literal requerido por backend. |
| El mockup de estudiante contradice el portal o wizard actual | Gana el código actual. Documentar la diferencia en el PR o cambio, sin sustituir comportamiento. |
| El mockup exige cambiar rol, permiso, ruta, relación representante-estudiante o orden de creación de personas | Detenerse y pedir una decisión concreta al responsable antes de editar. |

## Checklist de aceptación por pantalla

- [ ] `/login`: coincide visualmente con el mockup, los campos son accesibles, la contraseña puede mostrarse/ocultarse, los errores son legibles y el login redirige por rol.
- [ ] `/register`: reproduce la jerarquía y campos del mockup, conserva validación de contraseñas y estados de envío/error existentes.
- [ ] `/forgot-password`: coincide con el mockup y no simula una recuperación funcional inexistente.
- [ ] `/dashboard`: reproduce métricas, acciones y secciones del mockup; mantiene acceso exclusivo de administrador.
- [ ] `/members`: reproduce búsqueda, filtros, expansión y acciones; conserva la agrupación cuenta pagadora-estudiantes y estados vacíos.
- [ ] `/groups`: reproduce tarjetas/expansión y asignación; no rompe las reglas de grupo, horario y estudiante.
- [ ] `/payments`: reproduce lista, filtros y detalle; aprobar/rechazar conserva confirmación, validación del motivo, carga, éxito y error.
- [ ] `/attendance`: reproduce resumen, filtros, registros y horarios; distingue todos los estados de asistencia con texto y color.
- [ ] `/trainer`: reproduce el panel y enlaza al registro de asistencia; solo entrenador puede acceder.
- [ ] `/trainer/attendance`: reproduce las etapas del wizard; no cambia la transición de estados ni la confirmación existente.
- [ ] `/student`: conserva portal, permisos, selección de representados, escenarios y acciones actuales; solo adopta aspectos visuales compatibles del mockup.
- [ ] `/student/enroll`: conserva los cinco pasos, validaciones, creación de representante antes de estudiante cuando aplique, manejo de error y pruebas locales vigentes.

## Checklist global

- [ ] No se modificaron mockups HTML, datos de diseño ni cambios locales ajenos.
- [ ] No se crearon rutas nuevas para sustituir rutas existentes sin una decisión explícita.
- [ ] Cada pantalla protegida conserva `ProtectedRoute` y su lista de roles.
- [ ] La navegación muestra solo enlaces autorizados para el rol.
- [ ] No hay HTML con `onclick`, scripts embebidos, `any`, secretos, `console.log` de producción ni imports sin uso.
- [ ] Todos los controles son operables por teclado y tienen nombre accesible.
- [ ] Se verificaron estados loading, empty y error donde aplican.
- [ ] Se comprobó el diseño en escritorio y móvil.
- [ ] La lógica nueva tiene al menos una prueba unitaria conductual.

## Archivos y rutas relevantes

| Área | Archivos |
|---|---|
| Layout y navegación | `src/app/layout.tsx`, `src/components/Header.tsx`, `src/components/AuthProviderWrapper.tsx`, `src/lib/auth-utils.ts` |
| Sesión y protección | `src/contexts/AuthContext.tsx`, `src/components/ProtectedRoute.tsx`, `src/services/auth.ts` |
| Admin | `src/app/dashboard/page.tsx`, `src/app/members/page.tsx`, `src/app/groups/page.tsx`, `src/app/payments/page.tsx`, `src/app/attendance/page.tsx` |
| Entrenador | `src/app/trainer/page.tsx`, `src/app/trainer/attendance/page.tsx`, `src/app/trainer/attendance/attendance-utils.ts` |
| Estudiante | `src/app/student/page.tsx`, `src/app/student/enroll/page.tsx`, `src/app/student/enroll/enroll-utils.ts` |
| Dominio y datos | `src/types/domain.ts`, `src/services/api.ts`, `src/services/mockStore.ts`, `src/lib/persona-adapter.ts`, `src/mocks/members.ts`, `src/mocks/attendance.ts` |
| Utilidades de pantalla | `src/app/members/members-utils.ts`, `src/app/attendance/attendance-utils.ts`, `src/lib/groups-utils.ts` |
| Mockups | `design/admin-*-mockup-v1.html` |

## Comandos de verificación

Los comandos existentes en `package.json` son:

```bash
pnpm dev
pnpm lint
pnpm type-check
pnpm test
pnpm build
```

Orden mínimo antes de entregar: `pnpm lint`, `pnpm type-check` y `pnpm test`. Ejecutar `pnpm build` para comprobar la compilación de producción si el cambio alcanza componentes, rutas o configuración compartidos.

## Mensaje para el agente implementador

```text
Implementá los mockups HTML de design/ sobre las rutas existentes de esta aplicación Next.js 14, sin copiar HTML/scripts estáticos y sin crear rutas paralelas. Los mockups son fuente de verdad visual y funcional para todas las pantallas excepto estudiante.

Excepción obligatoria: para /student y /student/enroll la fuente de verdad es el código actual, incluidos los cambios locales no confirmados. Conservá el portal actual, la selección de representados, los escenarios de membresía/pago, el wizard de cinco pasos (type, personal, club, health, summary), sus validaciones y la creación de representante antes de estudiante cuando corresponda. El mockup admin-student-mockup-v1.html solo puede aportar referencias visuales compatibles.

Mapeo: login→/login, register→/register, forgot password→/forgot-password, panel→/dashboard, members→/members, groups→/groups, payments→/payments, attendance→/attendance, trainer→/trainer, trainer attendance→/trainer/attendance, student→/student. Conservá ProtectedRoute y roles: admin para rutas administrativas; trainer para rutas de entrenador; representante y estudiante para rutas de estudiante. La navegación debe seguir derivándose de src/lib/auth-utils.ts.

Usá React y Tailwind; convertí interacciones de los HTML a estado/controladores React tipados. No uses any, scripts embebidos, onclick ni manipulación directa del DOM. Conservá contratos y utilidades existentes en src/types/domain.ts, src/services/api.ts, src/services/mockStore.ts, src/mocks/, members-utils.ts, attendance-utils.ts y groups-utils.ts. No inventes datos de horarios, reglas de dominio, servicios de pago o recuperación de contraseña.

Para cada pantalla implementá loading, vacío y error cuando aplique, etiquetas accesibles, aria-label en botones solo con icono, estados activos no comunicados solo por color y comportamiento responsive. No modifiques mockups ni reviertas cambios locales ajenos.

Si encontrás una contradicción que exija cambiar ruta, rol, permiso, relación representante-estudiante, persistencia, pago o el flujo de inscripción, detenete y preguntá antes de decidir. Para diferencias visuales menores, preservá el contrato de código y aplicá el diseño del mockup.

Al terminar ejecutá: pnpm lint, pnpm type-check, pnpm test y, si tocaste rutas/componentes compartidos, pnpm build. Reportá archivos modificados, verificaciones y cualquier diferencia documentada.
```
