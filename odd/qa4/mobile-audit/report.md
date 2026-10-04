# Auditoría móvil del release candidate (QA4)

- Árbol auditado: `195d9ee4` (RC final), rama `qa4-mobile-audit`.
- Motor: Chromium emulando Pixel 7 (412×915, puntero táctil) y de nuevo a 360×740, el teléfono más angosto que aún se usa.
- Backend simulado a nivel de red (como el resto de los e2e): no se usó ningún servicio real ni `db-test`.
- Guardia permanente: `frontend/tests/e2e/mobile-audit.mobile.spec.ts` (proyecto `mobile-chromium`). El nombre lleva `.mobile.` porque es lo que el proyecto reconoce y evita que el proyecto de escritorio lo corra. Las capturas salen a `odd/qa4/mobile-audit/screens/` (ignorada por git).

## Resultado

| | Encontrados | Corregidos |
|---|---|---|
| Blocker | 0 | 0 |
| Major | 6 | 6 |
| Minor | 8 | 0 (quedan listados; ninguno es un cambio trivial de una línea) |

31 pantallas × 2 anchos = 62 corridas. Estado final: las 62 pasan, con 0 desborde horizontal, 0 errores de consola y 0 voseo o «usted» fuera de las páginas legales.

Lo que se comprueba en cada pantalla: (a) sin desborde horizontal; (b) objetivos táctiles de al menos 44×44 px (o área de toque equivalente); (c) sin errores de consola; (d) sin voseo, y sin imperativos de «usted» salvo en términos y privacidad.

Pantallas: públicas (landing, login, inscripción, ayuda, términos, privacidad); representante (agregar jugador, portal, pagos, asistencias, perfil, ficha médica); jugador adulto (portal, pagos, asistencias, perfil, ficha médica); entrenador (día, asistencia, jugadores); administración (panel, miembros, pagos, grupos, descuentos, tarifas, reportes, actividad, errores reportados, galería, patrocinadores).

## Hallazgos por pantalla

### Major (todos corregidos)

| # | Pantallas | Hallazgo | Corrección |
|---|---|---|---|
| M1 | Todas las autenticadas, login, inscripción | Todo control del sistema de diseño medía 40 px (`h-ctl`) o 32 px (`h-ctl-sm`) y los campos 40–42 px. Eran las acciones principales: Iniciar sesión, Aprobar, Registrar pago, Siguiente, filtros y pestañas. | `3f89dbac`: piso de 44 px solo con puntero táctil (`@media (pointer: coarse)`) para `h-ctl*` y `.input-field`. El escritorio no cambia. |
| M2 | Todas las de administración y portal (cabecera) | Campana de notificaciones 31×31, botón de búsqueda 41×40, botón «Menú» 40 de alto. | `3f89dbac` |
| M3 | Login, restablecer contraseña, perfil, asistentes de registro | Ojo de «Mostrar contraseña» de 15–24 px. | `3f89dbac`: área de toque invisible de 44 px sin mover el ícono. |
| M4 | Ayuda | Preguntas frecuentes de 40 px; además una regla propia de la página las bajaba a 40 px. | `3f89dbac` |
| M5 | Landing, legales | Enlace «Iniciar sesión» de 36 px, logo de 40 px, enlaces de contacto (teléfonos, redes) de 20–25 px, tarjetas de documentos legales de 40 px. | `3f89dbac` |
| M6 | Asistencias, pagos y ficha médica del representante, a 360 px | El selector de jugador con un nombre largo empujaba la página 6 px fuera del ancho. | segundo commit `fix(student)` |

### Minor (listados, sin corregir)

| # | Pantalla | Hallazgo |
|---|---|---|
| m1 | Portal (jugador y representante) | «Imprimir carnet» mide 24 px de alto. |
| m2 | Portal | Enlaces secundarios «Ver pagos», «Ver mis asistencias», «Ver las asistencias de …» de 24 px. |
| m3 | Login | «¿Olvidaste tu contraseña?» (24 px), «Inscríbete» y «Escríbenos por WhatsApp» (19 px) son enlaces de texto bajo el formulario. |
| m4 | Términos y privacidad | El correo y los dos WhatsApp dentro del texto legal miden 20 px. |
| m5 | Panel de administración | Enlaces al pie de las tarjetas de cifras («82 % del total», «Revisar pagos», «0 de 0 registros») de 19 px. |
| m6 | Actividad del club | Fichas de leyenda (Jugadores, Entrenadores, Representantes) de 29 px y el desplegable «Ver como tabla» de 19 px. |
| m7 | Día del entrenador | El desplegable «Es una estimación» mide 19 px. |
| m8 | Miembros (412) y agregar jugador (360) | Un error de hidratación de React (#418) apareció 2 veces en las primeras corridas y no volvió a aparecer en las 4 siguientes. No es reproducible; conviene vigilarlo en la cuenta con datos reales. |

Estos minor están en la lista de excepciones del spec (con su motivo), de modo que la guardia protege todo lo demás. Al corregir uno, se borra su línea.

## Notas para quien decide

- El criterio de accesibilidad del proyecto (`docs/ux/objetivo-tactil.md`) es WCAG 2.5.8 (24 px). Esta auditoría usó 44 px, como se pidió, y el piso nuevo solo actúa con puntero táctil; ese documento y el encabezado de `touch-target-usage.test.ts` siguen siendo ciertos para el ratón, pero conviene actualizarlos para que mencionen el piso móvil (no estaba en las superficies editables de esta tarea).
- La etiqueta del selector («Estudiante») y otras palabras de glosario no las detecta el chequeo de registro; es el tema de W3-7, no de esta auditoría.
- Una trampa del propio método: en Chrome móvil, `window.innerWidth` crece cuando hay desborde, así que `scrollWidth <= innerWidth` daba falso verde. El spec compara contra el ancho configurado.

## Qué no cubre (necesita el stack real)

- Los datos son de mentira y mínimos (una cuenta, un pago, un horario): pantallas con listas largas, paginación real y fotos reales de la galería solo se vieron con datos de prueba o vacías.
- Diálogos y flujos (registrar un pago, corregir asistencia, subir comprobante, exportar PDF o Excel) no se abrieron; la auditoría mide cada ruta tal como carga.
- Fuera de la lista pedida: `/trainer/attendance/history`, `/login/activacion`, olvidé/restablecer contraseña, verificar correo, no autorizado, permiso de imagen FETM, crear cuenta.
- Un jugador menor con cuenta propia no puede abrir la ficha médica (es a propósito); se auditó con un jugador adulto.
