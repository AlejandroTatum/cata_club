# Plan de implementación — Rediseño Cata Club "La Paleta"

- **Fecha:** 23 de julio de 2026 · **Actualizado:** 25 de julio de 2026 tras la auditoría UX de dos superficies
- **Estado:** aprobado por Alejandro; Fase 0 y Fase L implementadas en la rama `fix/ux-audit-remediation`
- **Prototipo aprobado (fuente de verdad visual):** `docs/ux/prototipos/` — 30 vistas + `_sistema.css`,
  con `index.html` como índice navegable. **Supersede a `docs/ux/prototipo-rediseno.html`** (14 vistas,
  23 jul), que queda como referencia histórica. `_sistema.css` es la especificación de tokens ejecutable:
  contiene coal/ball, alturas 40/32 px, stat 116 px, radius 14/10 y la gama de niveles l1–l10.
- **Auditoría UX (25 jul):** `.impeccable/critique/2026-07-25T04-37-47Z__frontend-src-app-landing.md`
  (landing, 20/36) y `__frontend-src-app.md` (app, 20/40). Incluyen medición real de navegador.
- **Evaluación de usabilidad + backlog:** `docs/ux/evaluacion-usabilidad-rediseno.md` (73/100; meta ≥ 8,5 tras Fase 5)
- **Logo:** `frontend/public/brand/cata-club-logo.jpeg` (montar siempre en disco blanco redondo)
- **Credenciales dev:** admin@cataclub.com/admin12345 · entrenador@cataclub.com/trainer12345 · ana@/laura@ → alumno123

## Concepto y reglas duras del sistema (NO negociables)

Concepto **"la paleta"**: goma roja `#D92128` + goma negra/carbón `#131316` + pelota amarilla `#FFD600` como acento de atención.

1. **Alturas por token:** TODOS los controles (botones, inputs, pills, search) = **40px**; acciones dentro de tablas = **32px**; stat cards = **116px** fijos; radius 14px cards / 10px controles; filas de tabla 60px, headers 44px, badges 26px.
2. **Números de stats SIEMPRE en tinta** (`#17181C`); el color vive solo en badges/pills de estado.
3. **Selección/activo = carbón + punto pelota amarilla.** El rojo se reserva EXCLUSIVAMENTE para CTA primaria y errores/destructivo.
4. **Niveles: 1 = cima, 10 = base.** Chips con gama secuencial de grises (l1 `#131316` texto amarillo → l10 `#E9E9EC` texto tinta). **SIN indicadores de ocupación/mínimos** (medidores, fracciones N/M, "Bajo mínimo" — decisión de producto: intrascendente para el cliente). **SIN acción "Promover"** — solo "Asignar".
5. **4 estados de asistencia:** Presente (verde `#157F3D`), Tardanza (ámbar `#B45309`), Justificado (gris neutro), Ausente (rojo). "Sin membresía" = badge gris neutro, nunca rojo.
6. **Minimalismo por superficie:** un mensaje, una acción; sin decoración pegada a datos; fechas humanizadas ("Hoy, 23 jul", "1 jul → 12 ago") y dd/mm/yyyy; copy en español neutro; Inter.
7. **Referencia de calidad:** el Login del prototipo (composición centrada, card elevada, dato único) es el estándar contra el que se revisa toda pantalla.

## FASE 1 — Fundación (design system + shell)

1. `frontend/tailwind.config.ts`: agregar tokens — `coal` (#131316, #1C1C21, #26262C), `ball` (#FFD600) + `ball-ink` (#8A6D00), alturas (`control: 40px`, `control-sm: 32px`), radius, gama de niveles l1–l10; conservar rojos cata existentes.
2. `globals.css` / componentes UI nuevos en `frontend/src/components/ui/`: Button (pri/dark/sec + sm), StatCard (116px, variante `hot` carbón con punto pelota), Badge (pill 26px con punto), Pill filtro (40px, activa = carbón+pelota), SearchInput, LevelChip (gama), Stepper (pasos nombrados), Table primitives.
3. **Shell unificado**: extender `frontend/src/components/shell/AppShell.tsx` a TODAS las rutas admin (hoy admin usa hamburger sin sidebar). Sidebar carbón: logo en disco blanco, ítem activo con barra roja izquierda + punto pelota, badge contador en "Membresías y Pagos", "Ayuda y soporte" (abre ChatWidget) + user card al fondo. **Eliminar el FAB flotante de ayuda** (tapaba contenido en 8+ pantallas).
4. Iconos: `lucide-react` (trazo 2px) — nav: layout-grid, users, trophy, calendar, credit-card, clipboard-check, file-text; search, bell, message-circle, lock, tag, sun, menu, send, x.
5. Tests: unit de componentes UI (alturas, variantes) siguiendo el patrón de tests existente del repo.

## FASE 0 — Defectos auditados (HECHA, commit `ade21ef`)

Siete defectos verificados con medición, no con opinión. Todos con test que falla primero.

1. ✅ `trainer/attendance`: el roster arrancaba en `"absent"`, así que tocar Continuar → Siguiente →
   Confirmar registraba la sesión entera como ausente — y el roster paginaba de a 10 sobre 44, así que
   los de la página 2 se enviaban ausentes en silencio. Centinela `UNMARKED` solo de frontend, contador
   "Sin marcar" sobre el roster completo, acción "Marcar restantes presentes", envío bloqueado.
2. ✅ Botones de estado de 30 px → 44 px en una sola fila, envueltos en `radiogroup`.
3. ✅ `members`: "Guardar cambios" no guardaba nada (ambos botones compartían handler).
4. ✅ `members`: crear membresía pedía recargar; ahora refresca sin desmontar el diálogo abierto.
5. ✅ `payments`: overflow horizontal de 60 px a 390 px (fila de filtros sin `flex-wrap`).
6. ✅ Contraste: "Sin asignar" 2,31:1 → 9,37:1; token `fuchsia-ink` para rosa sobre claro.
7. ✅ Drawer móvil cerrado dejaba 11 controles en el orden de tabulación.

## FASE L — Landing como embudo (HECHA)

CTA de inscripción, WhatsApp con `wa.me`, navbar sticky, `metadata`/OpenGraph propios, banner de
confianza sin datos inventados, contraste y responsive del bloque de horarios.

**Hallazgo que cambió el plan:** `/register` se documenta a sí mismo como *"demo placeholder
(no backend account creation yet)"* y le dice al visitante *"No se almacenó ningún dato"*. El flujo
real de inscripción pública es `/student/enroll`, que sí postea al backend. Los CTA apuntan ahí.
Decidir qué se hace con `/register` es una decisión de producto pendiente.

**Datos removidos por no tener fuente verificada** (necesitan input del cliente):
`+80 deportistas en formación` (era `TODO(client)`), el horario de contacto `Lun–Sáb 16:00–20:30`
(era `TODO(client)` y contradecía los horarios publicados, 15:00–21:15), y "Alto rendimiento"
como servicio del footer (no existe en el repo; los horarios dicen Competitivo/Selección).

## FASE 2 — Bugs funcionales (independiente, puede ir primero)

1. **Rol representante roto:** laura@cataclub.com cae en `/unauthorized` tras login pero `/student` renderiza ("Rol no soportado"). Definir ruta de aterrizaje del representante (portal student con cards por hijo) y permitir `add-dependent`.
2. **`/trainer/nivel` 403:** llama a `/api/members` (admin-only) — usar endpoint propio con permisos de trainer.
3. **Wizard registro:** panel "RELLENAR DATOS DE PRUEBA (SOLO DESARROLLO)" detrás de flag de entorno.
4. ~~**Fechas `mm/dd/yyyy`** en UI español (reports, register) → dd/mm/yyyy.~~ **DESMENTIDO por la
   auditoría del 25 jul:** no existe ni un `mm/dd/yyyy` generado por la app. Las 6 llamadas a fecha
   están pineadas a `es-EC` y hay cero `toLocaleDateString()` sin pinear. El problema real es otro y
   pasa a la Fase 5: **ISO crudo conviviendo con formato largo en la misma fila** (en `/payments`,
   PERÍODO muestra `2026-07-01 – 2026-08-12` y SUBIDO muestra `23 de julio de 2026`), más
   `reports` mostrando `1990-01-01` en "Fecha Nac.". Único caso dependiente del entorno: los
   `input[type=date]` de `/reports` renderizan según el locale del navegador, no del documento.
5. ~~Revisar redirect `/products` → `/payments` (deprecado, decidir si se elimina).~~ **RESUELTO:**
   `rg` sobre `frontend/src` no encontró ni un `href`, `router.push` o `redirect` apuntando a
   `/products`; la ruta se eliminó.

## FASE 3 — Pantallas admin

1. **Dashboard "jornada"** (`app/dashboard`): hero carbón MINIMAL — solo número grande de prioridad (pagos por validar + "N llevan más de una semana") y botón "Revisar ahora"; NADA más en el hero. Pulso de 3 stats (Miembros; Membresías activas con barra de progreso; Asistencia 4 semanas con sparkbars). Feed "Actividad reciente" (requiere endpoint nuevo o derivar de eventos existentes). Donut 4 estados (SVG, ya existe el dato en `/api/dashboard`).
2. **Pagos** (`app/payments`): tabla 5 columnas — Estudiante (responsable como subtítulo "Paga: …"), Período humanizado, Monto, Método, Estado + acción por fila (Revisar primaria si pendiente / Detalle secundaria). Filtro inicial en **Pendientes**. En móvil colapsa a cards (como ya hace members).
3. **Asistencias** (`app/attendance`): stats fila + "Tomar asistencia" como botón primario del header (no banner) + filtros rango/horario/alumno (reutilizar los del trainer) + tabla de registros con fechas humanas y 4 badges.
4. **Niveles** (`app/ranking`): "la escalera" — lista vertical 1→10 con riel conector, chip gama por escalón, nombre, pila de avatares, acción única "Asignar". Stats: Estudiantes asignados + Niveles (solo 2, sin juicio).
5. **Horarios** (`app/groups`): grilla de cards filtrable por día (los 26 visibles), entrenador/mesa, "N inscriptos" plano, Ver alumnos + Editar. **SIN información de nivel en las cards** (decisión de producto).
6. **Reportes** (`app/reports`): 3 preset cards a altura pareja (selección carbón+pelota), rango dd/mm/yyyy, botón Generar PDF, zona de vista previa (llena el lienzo vacío actual).
7. **Miembros** (`app/members`): stats fila + búsqueda/pills 40px + tabla (badge "Sin membresía" gris neutro).

## FASE 4 — Auth, roles, procesos y móvil

1. **AuthShell** (`components/auth/AuthShell.tsx`): panel izquierdo carbón con composición CENTRADA — logo disco 104px, «"Formando **campeones** para la vida"» (campeones en amarillo, frase de la landing), subtítulo "Cada entrenamiento es una oportunidad para superarte.", divisor + UN dato (estudiantes inscritos), copyright abajo, "← Volver al sitio" arriba-izquierda. Panel derecho: formulario en **card blanca elevada** (radius 18, sombra), nota de seguridad en texto chico DEBAJO de la card. Register/forgot/reset heredan el template (hoy reset rompe el layout).
2. **Trainer** (`app/trainer`): "Hola, Carlos" + hero próxima sesión (hora en 46px, "En N minutos · 12 estudiantes esperan…", botón XL "Pasar lista") + línea "Después: 16:00 · 17:00" + panel "Última lista" con dato accionable (ausencias acumuladas → "Avisar al club"). **SIN sección Niveles para trainer.**
3. **Proceso Tomar asistencia** (`app/trainer/attendance`): wizard 3 pasos con stepper NOMBRADO (✓ Horario · Lunes 15:00 → 2 Pasar lista → 3 Confirmar). Paso 1 conserva acordeón por día. Paso 2: fichas compactas **48px una línea** (avatar + nombre + estado), TODA la ficha es blanco táctil y cicla Sin marcar→Presente→Tardanza→Justificado→Ausente; marcador vivo "7/12 presentes" en header carbón; "Marcar restantes presentes"; savebar con totales + Continuar. SIN chip de nivel por ficha (redundante).
4. **Proceso Inscripción** (`app/student/enroll` + register wizard): 5 pasos con stepper nombrado (Tipo/Estudiante/Contacto/Membresía/Confirmar); cards de elección a altura pareja con selección carbón+pelota (NO rojo); mismo wizard alimenta `add-dependent`.
5. **Student** (`app/student`): "Hola, Ana" + **carnet del club** (card gradiente carbón, logo disco, nombre, chip nivel gama, badge membresía, "MIEMBRO Nº · DESDE", renovación) + panel próximo entrenamiento ("viniste 7 de 9") + Mis pagos con vacío accionable: monto resuelto ("Tu mensualidad de agosto: $25,00") + botón "Subir comprobante". CTAs contextuales (sin "inscribir hijo" para self-managed).
6. **Perfil** (`app/profile`): contenido a max-width ~760px, "Editar datos" en el header. Card identidad con aire (avatar 72px carbón/amarillo, nombre 20px, correo, badge rol — nada más). Datos personales como **lista de filas de 56px** (etiqueta uppercase 150px a la izquierda / valor bold a la derecha, un dato por fila, divisores; la nota de la cédula inline a la derecha). Seguridad igual: 3 filas de acción (Cambiar contraseña / Cerrar otras sesiones / Salir). NUNCA grids apretadas de datos. **`/unauthorized` es pantalla propia**: logo, "Tu cuenta todavía no tiene rol", qué hacer, CTAs Contactar al club + Cerrar sesión.
7. **ChatWidget** (`components/chatbot/ChatWidget.tsx`): rediseño con el sistema — header carbón con logo y "Responde en segundos", burbujas bot (gris)/usuario (carbón), quick replies 32px (incluir "Hablar con el club"), indicador de escritura (3 puntos, respeta reduced-motion), input 40px + botón enviar rojo 40px. Se abre desde "Ayuda y soporte" del sidebar (sin FAB).
8. **Móvil**: tab bar inferior para admin (Panel/Miembros/Pagos/Más) en vez de hamburger; stats 2×2 (96px); pagos y tablas colapsan a cards.

## FASE 5 — Backlog de usabilidad

Ejecutar `docs/ux/evaluacion-usabilidad-rediseno.md` (P5 prevención → P9 recuperación → P3 control → P1 visibilidad → P7 eficiencia) y re-evaluar con el cuestionario. Meta ≥ 8,5/10.

## Notas para el SDD

- Empezar con `sdd-explore` sobre este doc + el prototipo; una change por fase (la Fase 2 puede ir primero o en paralelo — no depende del design system).
- El prototipo es HTML estático: los data-notes (`Ver cambios`) documentan la intención de cada decisión.
- Stack: Next.js App Router + Tailwind (tokens en `tailwind.config.ts`), backend FastAPI ya expone dashboard stats, chatbot (`ChatbotServicio`), niveles con ocupación (NO exponer ocupación en UI), asistencia con 4 estados (`EstadoAsistencia`).
- Tests: seguir `testing-coverage` del repo; los cambios de comportamiento (wizards, ciclo de estados) requieren tests de utils/componentes.
