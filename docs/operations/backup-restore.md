# Runbook de backup y restore

Estado real: **no existe mecanismo de backup automatizado, ni restore
probado, ni decisión de RPO/RTO en el repo.** Este documento no simula una
capacidad que no está implementada: describe lo que hay hoy, lo que se
necesita decidir, y la guía técnica mínima basada en interfaces reales para
cuando la decisión se tome.

> **Estado:** Activa (capacidad **no implementada**)
>
> **Responsable:** Infraestructura (asignación nominal pendiente — ver
> [`../reference/ownership.md`](../reference/ownership.md))
>
> **Audiencia:** operador, desarrollo y producto
>
> **Última verificación:** 2026-08-13 · **Verificado contra commit:** `fd9f7be`
>
> **Revisión recomendada:** al tomar la decisión de backup, y con cada cambio del servicio `db`

## Estado actual (verificado)

| Qué | Estado | Evidencia |
|---|---|---|
| Backup automatizado de Postgres en producción | **No existe** | No hay script, servicio, job ni volumen de backup en `docker-compose*.yml`, `Makefile` ni `.github/workflows/ci.yml` |
| Restore probado | **No existe** | Sin procedimiento ejecutado ni evidencia |
| Volumen de datos de producción | Depende del host (decisión no documentada) | La base define `cataclub_db_data` solo en `docker-compose.yml` (dev); el overlay de producción no la redefine |
| Postgres de QA | Desechable por diseño | `docker-compose.qa.yml`: `tmpfs` — no existe volumen donde sobrevivan datos |
| Postgres de tests | Desechable por diseño | `docker-compose.yml`: servicio `db-test` con `tmpfs` |

Dato de contexto: la rotación de logs del overlay de producción existe para
evitar que el disco se llene — Postgres es el primer servicio en morir sin
espacio (no puede escribir WAL) —, pero eso no es backup.

## Decisión pendiente (bloquea readiness)

1. **¿Backup de qué base?** Producción usa el servicio `db` del stack
   (`postgres:16-alpine`), cuyo hostname interno es `db`.
2. **¿RPO y RTO?** Propuesta de arranque para discutir: dump diario fuera
   del droplet (otro host u objeto de almacenamiento) + verificación
   mensual de restore. Datos de menores y pagos justifican RPO corto.
3. **¿Quién ejecuta y verifica?** Owner nominal pendiente
   ([`../reference/ownership.md`](../reference/ownership.md)).

## Guía técnica de referencia (NO probada — para cuando exista la decisión)

Comandos contra interfaces reales del repo, listos para adaptar cuando el
mecanismo se implemente. Nada de esto corrió todavía.

```bash
# Dump de la base productiva hacia el host (ejecutar en el host del stack)
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T db \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom > cata_club_$(date +%F).dump
```

> **No hay comando de restore ejecutable.** Restaurar es destructivo
> (`pg_restore` reemplaza la base destino) y el único Postgres con volumen
> persistente del repo es el servicio `db` del stack de producción: ejecutar
> un restore ahí **borraría la base productiva**. Hasta que exista un entorno
> de restore aislado, el dump de arriba es la única operación ejecutable.

**Cómo validar un restore futuro sin tocar producción** (cuando exista el
entorno):

1. Levantar una base **desechable e independiente**, con nombre explícito
   **no productivo** (p. ej. `cataclub-restore`), nunca el `db` del stack
   productivo ni el volumen `cataclub_db_data`.
2. Restaurar el dump ahí con `pg_restore` (seguro: el entorno se destruye al terminar).
3. Validar la restauración: `alembic_version` == revisión que espera el SHA de
   la app; conteos de tablas críticas contra el origen; el backend arranca y
   pasa `/health/ready`.
4. Destruir el entorno desechable. Un restore verificado de punta a punta así
   desbloquea la fila «Backup y restore de Postgres» en
   [`production-readiness.md`](production-readiness.md).

## Acciones concretas

- Decidir RPO/RTO y proveedor de almacenamiento del dump (fuera del
  droplet).
- Implementar el job de backup (cron del host o servicio) y **probar el
  restore de punta a punta** en un entorno desechable antes de producción.
- Registrar la evidencia en [`production-readiness.md`](production-readiness.md):
  la fila «Backup y restore de Postgres» pasa de *Not evaluated* a
  *Needs evidence* cuando exista el mecanismo, y a *Ready* cuando el restore
  se haya ejecutado y verificado.
