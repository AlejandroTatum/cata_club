# Archivo documental — Cata Club

Todo lo que está acá es **histórico o evidencia**: captura un momento y no se
actualiza más. Nada de este árbol se reescribe para corregir el pasado; si un
documento vivo corrige algo de acá, la corrección vive en el documento activo y
este registro queda como estaba. Única excepción a la inmutabilidad: la
redacción de secretos, siempre documentada en el
[`MANIFIESTO.md`](MANIFIESTO.md) (§2).

> **Regla de oro:** nunca se corrige el pasado en un documento histórico; se
> referencia desde el documento activo.
>
> **Regla de hierro:** el archivo no se borra. Git conserva los blobs aun si
> algún día se quita un archivo del árbol de trabajo: mover o eliminar aquí no
> reduce el historial del repositorio.

## Qué es cada subárbol

| Subárbol | Qué contiene | Ejemplo |
|---|---|---|
| `audits/YYYY-MM-DD/` | Snapshots de auditorías y verificaciones, fechados, con su evidencia adyacente (capturas y raw) en la misma carpeta | `audits/2026-08-12/README.md` + `audits/2026-08-12/img/` |
| `fixes/` | Dossiers históricos de la tanda de corrección (uno por fix, con imágenes before/after) y sus integraciones | `fixes/01-pago-sin-comprobante.md` + `fixes/img/` |
| `plans/` | Planes y listas de pendientes superados por la lista viva de readiness | `plans/pendientes-2026-08-11.md` |
| `sessions/YYYY-MM-DD/` | Cierres de sesión y bitácoras de trabajo fechados | `sessions/2026-08-11/cierre-sesion.md` |
| `prototypes/` | Prototipos HTML, evaluaciones de usabilidad y planes de implementación del rediseño, con sus capturas | `prototypes/prototipos/`, `prototypes/capturas/` |

No se creó `archive/evidence/`: cada pieza de evidencia suelta encontrada
pertenecía a una auditoría, un fix o un prototipo, y viajó con su dueño. Si
algún día aparece evidencia huérfana, este subárbol se crea en ese momento.

## Navegación por fecha

| Fecha | Qué pasó | Dónde |
|---|---|---|
| 2026-07-27 | Auditoría de calidad/preparación para producción + hallazgos post-presentación | `audits/2026-07-27/` |
| 2026-08-10 | Auditoría de producto (52 hallazgos, 24 confirmados) + verificación en QA | `audits/2026-08-10/` |
| 2026-08-11 | Re-verificación de la auditoría + cierre de sesión (10–11 ago) | `audits/2026-08-11/`, `sessions/2026-08-11/` |
| 2026-08-12 | QA del registro de cuentas (inscripción, 81 casos) | `audits/2026-08-12/` |

## Autoridad vigente (fuera de este árbol)

- Lista viva de preparación para producción:
  [`../operations/production-readiness.md`](../operations/production-readiness.md)
  — **reemplaza** a `plans/pendientes.md`, `plans/pendientes-2026-08-11.md` y
  `plans/plan-de-lanzamiento.md`.
- Método de trabajo del equipo:
  [`../reference/como-trabajamos.md`](../reference/como-trabajamos.md)
- Decisiones de negocio (durables, siguen gobernando reglas):
  [`../product/decisiones-de-negocio-2026-08-11.md`](../product/decisiones-de-negocio-2026-08-11.md)

## Manifiesto y trazabilidad

El detalle origen → destino de cada archivo, con commit/fecha de creación,
sensibilidad y delete-candidates está en [`MANIFIESTO.md`](MANIFIESTO.md).
Leelo antes de tocar cualquier archivo de este árbol.

## Follow-ups registrados (fuera del alcance de esta reorganización)

Documentación técnica que vive fuera de `docs/` y que este PR no movió, para
decidir en un PR aparte:

- `frontend/openspec/` — propuestas y reportes SDD/openspec que citan
  `docs/ux/`, `docs/auditoria-qa/` y `docs/fixes/` con rutas pre-reorganización
  (10 archivos). Son snapshots de proceso; se dejan intactos y sus citas se
  leen como historia.
- `frontend/design/`, `client-deliverables/`, `.impeccable/`, `.claude/` —
  material de diseño/entregables no movido por pedido explícito de mantener el
  alcance en `docs/`.
- `docs/ux/` — conserva solo normas activas (objetivo táctil, escalas de
  iconos/tipografía, ritmo vertical, candado de valores arbitrarios); la
  evaluación, el plan de implementación y los prototipos viven en
  `prototypes/`.
