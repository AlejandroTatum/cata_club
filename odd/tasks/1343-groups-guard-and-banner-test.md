# 1343 — Follow-ups advisory del review de #1342 (type predicate en la rama negativa, test del camino directo)

Issue: https://github.com/AlejandroTatum/cata_club/issues/1343
Branch: `chore/1343-groups-guard-and-banner-test` (worktree `cata_club-worktrees/gentleman-1343`, cortada de `origin/main` @ 991f682)
TDD: **on** (strict). Runners: `cd frontend && pnpm vitest run <file>`; `pnpm type-check`.
RDD: no se toca en este trabajo (instrucción explícita del brief: no correr `gentle-ai review`, no pushear, no abrir PR — queda a cargo del orquestador).

## Objetivo

Cerrar los 2 hallazgos advisory del review nativo del PR #1342 (issue #1325, lineage `review-d5e482355e3ce22d`, lente reliability, aprobado, se cierran aparte).

## Tareas

- [x] T1 — `puedeEliminarCategoria` (R3-001, `frontend/src/app/groups/groups-page-utils.ts` ~412-416): el type predicate `editingGroup is HorarioGroup` miente en la rama negativa para un `HorarioGroup` real con `rows: []`. Cambiado a `boolean` plano; call site en `page.tsx` (~1166) ahora hace el narrowing explícito: `editingGroup !== null && puedeEliminarCategoria(editingGroup) && (...)`.
- [x] T2 — `submitCategoria` (R3-002, `frontend/src/app/groups/page.tsx` ~797): el `setDuplicateCategoriaCodigo(null)` incondicional al inicio, en el camino directo desde `handleConfirmPendingDeletions` (confirmación de borrados pendientes), no tenía test propio. Nuevo test en `GroupsPage.test.tsx` que deja un banner de duplicado stale y confirma por ese camino.

## Evidencia

### T1 — predicate → boolean

- **RED (tsc, no runtime)**: con la firma actual (`editingGroup is HorarioGroup`), el snippet `if (!puedeEliminarCategoria(g)) { g.rows }` con `g: HorarioGroup` (no-nullable) no compila: `pnpm type-check` → `Property 'rows' does not exist on type 'never'`. Verificado agregando exactamente ese snippet como test nuevo en `groups-page-utils.test.ts` (dentro de un `it`, con `catalogoUnicamente: HorarioGroup` de `rows: []`) y corriendo `pnpm type-check` → 1 error, esa línea.
- **GREEN**: helper cambiado a `boolean` plano + call site con `editingGroup !== null &&` explícito → `pnpm type-check` limpio. `pnpm vitest run src/app/groups/__tests__/groups-page-utils.test.ts` → **46 passed** (incluye el test nuevo, que también corre en runtime: `puedeEliminarCategoria(catalogoUnicamente)` sigue devolviendo `false`, comportamiento sin cambios).
- Runtime del helper no cambió (ya devolvía `false` correctamente) — el hallazgo era puramente de tipos, como anticipaba el brief.

### T2 — test del camino directo

- Diseño inicial (dos rechazos consecutivos en `mockActualizarCategoria`, aserción end-state tras confirmar) pasaba con el código actual — esperado. Para intentar aislar la línea exacta (`submitCategoria` línea 797) se sabotearon, uno por uno y luego juntos, el clear de `submitCategoria` (797) y el de `handleSubmit` (858): en los tres casos el test siguió en verde.
- **Hallazgo (documentado, no un bug)**: la línea 797 es código muerto observable — cualquier ejecución de `submitCategoria` termina en éxito (`closeExpanded()` línea 772 también limpia `duplicateCategoriaCodigo`) o en el `catch`, que hace `setDuplicateCategoriaCodigo(codigoDuplicado)` incondicional (línea ~828-829, `null` para un error no-duplicado). Además el botón "Editar «X»" está anidado dentro de `{formError && (...)}`, y `setFormError(null)` (no discutido) ya vacía ese bloque apenas arranca `submitCategoria`, enmascarando cualquier diferencia de `duplicateCategoriaCodigo` mientras el request está en vuelo. No hay forma de producir un RED real vía DOM para esta línea específica sin tocar código no relacionado con el issue.
- Test final entregado como test de **pin** (coverage del camino, no bug-catching): dos rechazos distintos, confirmación por el diálogo de borrados pendientes, aserción de que el banner viejo desaparece y el nuevo mensaje se muestra. Cumple el criterio de cierre del issue ("el camino directo de `submitCategoria` tiene un test que fija la limpieza del banner") aunque no aísla la línea 797 en particular.
- `pnpm vitest run src/app/groups/__tests__/GroupsPage.test.tsx` → **97 passed**.

### Verificación final

- `pnpm type-check` → limpio.
- `make pre-pr LANE=frontend` → ver reporte del writer.
