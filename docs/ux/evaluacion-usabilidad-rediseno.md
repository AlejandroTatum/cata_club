# Evaluación de usabilidad — Rediseño Cata Club (Propuesta v3.4)

- **Fecha:** 23 de julio de 2026
- **Objeto evaluado:** Prototipo navegable del rediseño completo (13 vistas)
  — https://claude.ai/code/artifact/344a61f3-b297-43a2-8b5e-2e2fa8bb5b14
- **Método:** Cuestionario de 10 principios de usabilidad (heurísticas de Nielsen),
  escala 0 = no cumple · 5 = cumple parcialmente · 10 = cumple completamente.
- **Alcance:** se evalúa lo que el **diseño** demuestra. Los principios de
  comportamiento (3, 5, 9) solo pueden completarse en la implementación.

## Resultado

| N.º | Principio | Nota | Retroalimentación |
|---|---|---:|---|
| 1 | Visibilidad del estado del sistema | 7/10 | Marcador vivo 7/12 en Pasar lista, badge "14" en navegación, stepper con pasos nombrados, campana con contador. Falta: estados de carga/guardado y confirmación visible tras cada acción. |
| 2 | Coincidencia con el mundo real | 9/10 | Lenguaje del club ("Pasar lista", "escalera", "carnet", "mensualidad"); fechas humanas ("Hoy, 23 jul", "1 jul → 12 ago"); escala de niveles 1–10 con 1 como cima; iconos convencionales. |
| 3 | Control y libertad del usuario | 6/10 | "Salir sin guardar", "Volver a Mi Cuenta", stepper navegable, "Corregir" última lista. Falta: deshacer acciones y confirmación antes de descartar cambios. |
| 4 | Consistencia y estándares | 9/10 | Un solo shell para todos los roles; tokens de altura (40/32 px); badges, pills y tablas idénticos en todas las vistas; gama única de niveles; un solo template de auth. |
| 5 | Prevención de errores | 5/10 | "Marcar restantes presentes" evita omisiones; wizard valida por pasos. Falta: validación de formularios en vivo y confirmaciones para acciones destructivas (rechazar pago, eliminar horario). |
| 6 | Reconocimiento antes que recuerdo | 8/10 | Pasos con nombre, filtros visibles con conteos, leyenda de estados siempre presente, montos resueltos ("Tu mensualidad: $25,00"). |
| 7 | Flexibilidad y eficiencia | 7/10 | Ctrl K, acción masiva en lista, filtro inicial en "Pendientes", deep-links del hero. Falta: acciones por lote en pagos y atajos documentados. |
| 8 | Diseño estético y minimalista | 9/10 | Hero de una sola prioridad, trainer con una decisión, fichas compactas de 48 px, sin decoración sobre datos. |
| 9 | Recuperación de errores | 5/10 | La pantalla "sin rol" es el modelo (qué pasó + qué hacer). Falta: errores de formulario, fallas de red, y motivo del pago rechazado con reintento. |
| 10 | Ayuda y documentación | 8/10 | Chat integrado accesible desde el menú, con respuestas contextuales y quick replies. Falta: tooltips de primera vez y enlace a documentación. |

**Puntaje total: 73/100 · Promedio: 7,3/10 → "Buena" (7,0–8,9)**

## Backlog de mejora post-integración

Los tres principios débiles son de **comportamiento**, no de diseño visual.
Trabajarlos después de integrar el rediseño, en este orden de impacto:

### P5 — Prevención de errores (5 → 8)
- [ ] Validación en vivo en todos los formularios (wizard de inscripción, login, registro de pago) con mensaje junto al campo.
- [ ] Modal de confirmación en acciones destructivas: rechazar pago, eliminar horario, quitar estudiante de nivel.
- [ ] Deshabilitar "Continuar"/"Guardar" hasta que el paso sea válido, con texto que explique qué falta.
- [ ] Restricciones de entrada: cédula (10 dígitos), teléfono, montos con formato.

### P9 — Recuperación de errores (5 → 8)
- [ ] Patrón único de error: qué pasó + cómo resolverlo + acción de reintento (modelo: pantalla "sin rol").
- [ ] Pago rechazado: mostrar SIEMPRE el motivo y CTA "Subir nuevo comprobante".
- [ ] Errores de red/servidor: banner con "Reintentar", nunca pantalla vacía.
- [ ] Corregir el 403 de `/trainer/nivel` (llama a `/api/members`, admin-only).

### P3 — Control y libertad (6 → 8)
- [ ] Deshacer al marcar asistencia (snackbar "Deshacer" 5 s) y al validar/rechazar un pago.
- [ ] Confirmación al salir de un wizard con cambios sin guardar.
- [ ] Guardado de borrador en el wizard de inscripción (retomar donde quedó).

### P1 — Visibilidad del estado (7 → 9)
- [ ] Spinners/esqueletos en cargas; toast de éxito tras guardar ("Lista guardada — 12 registros").
- [ ] Estado "guardando…" en el botón durante requests.

### P7 — Flexibilidad y eficiencia (7 → 9)
- [ ] Selección múltiple + validación por lote en la cola de pagos.
- [ ] Persistir filtros elegidos por usuario (localStorage/preferencias).

### P6 / P10 — Refuerzos menores
- [ ] Tooltips de primera vez en la escalera de niveles y el marcador de mínimo.
- [ ] Enlace a documentación/preguntas frecuentes desde el chat de ayuda.

## Re-evaluación

Repetir este cuestionario con el grupo evaluador después de integrar el rediseño
(fase 4) y nuevamente al cerrar el backlog anterior. Meta: **≥ 8,5/10**.

| Corte | Fecha | Total | Promedio |
|---|---|---|---|
| Prototipo v3.4 | 2026-07-23 | 73/100 | 7,3 |
| Post-integración | 2026-07-25 | **77/100** | **7,7** |
| Post-backlog | — | — | — |

## Corte post-integración — 2026-07-25

Evaluada la **implementación** corriendo, no el prototipo. Tres evaluadores
independientes y aislados: uno sobre admin/entrenador, uno sobre
estudiante/representante y público, y uno solo de medición determinista que los
otros dos no vieron.

| Superficie | Total | Promedio |
|---|---:|---:|
| Admin + entrenador | 76/100 | 7,6 |
| Estudiante + público | 77/100 | 7,7 |

**No alcanza la meta de ≥ 8,5.** Los dos evaluadores llegaron por separado al
mismo diagnóstico, lo cual le da peso: los principios que el backlog atacó
subieron de verdad, y el que el documento original difirió explícitamente a la
implementación **no se movió nada**.

| Principio | Prototipo | Ahora | |
|---|---:|---:|---|
| P5 Prevención de errores | 5 | **8** | Aprobar deshabilitado tras checklist real; motivo de rechazo obligatorio; wizard y reportes con botones bloqueados y el motivo dicho |
| P9 Recuperación de errores | 5 | **7–8** | Patrón de reintento verificado contra una caída real del servidor; el 403 de `/trainer/nivel` resuelto |
| P3 Control y libertad | 6 | **6** | Sin cambios: los tres ítems del backlog siguen sin hacer |
| P7 Flexibilidad | 7 | **7** | Ningún ítem del backlog entregado |
| P2 Mundo real | 9 | **8** | Regresión: vocabulario de base de datos filtrado a la UI y placeholders de seed visibles |

### Lo que bloquea la meta

1. **La selección de dependiente se pierde al navegar.** Laura elige a Martín en
   Mi cuenta, entra a Pagos y la pantalla vuelve a Sofía — plan, monto e
   historial de la otra hija. Es el único defecto con consecuencia de dinero.
2. **El botón Atrás del navegador destruye la lista de asistencia en curso**, sin
   aviso y sin borrador. Los tres pasos del wizard no son entradas de historial.
3. **No existe deshacer en ninguna parte.** "Corregir" en el historial es un
   viaje aparte, no un undo.
4. **El checklist de aprobación no se adapta al método de pago.** En un pago en
   efectivo exige afirmar que el comprobante es legible y que su monto coincide
   — sobre un comprobante que no existe. Una salvaguarda que hay que falsear
   enseña a tildar sin mirar.
5. **Sin acciones por lote en la cola de pagos.** Trece pagos idénticos son trece
   decisiones con checklist.

### Defectos medidos (evaluador determinista)

- Cero overflow horizontal y cero errores de consola en todas las páginas
  medidas, a 1440 y a 390. Jerarquía de encabezados correcta en todas.
- Cuatro fallos de contraste reales, el peor 2,31:1 (panel de datos de prueba en
  `/student/enroll`) y 3,78:1 en la nota de seguridad del login.
- **Los indicadores de foco fallan WCAG 2.4.11 en superficie clara**:
  `outline-ball` mide 1,42:1 sobre blanco contra los 3:1 requeridos. Corregido
  solo en el asistente; el resto del sistema mantiene el defecto.
- `AppShell` no tiene enlace de salto al contenido; el landing sí.
- Logos del landing, de enroll y del carnet con `alt` vacío.
- Objetivos táctiles: el token `h-ctl` es 40 px, bajo los 44 recomendados, de
  forma sistemática en todo el shell.

### No se pudo evaluar

Todo lo posterior a un envío — toasts de éxito, estados "Guardando…", pantallas
de confirmación — porque la evaluación se hizo sin mutar la base. Los flujos por
teclado quedaron incompletos: los tres evaluadores compartían un solo navegador
y las sesiones se pisaban entre sí.
