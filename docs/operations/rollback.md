# Runbook de rollback

Cómo volver a una versión anterior del stack cuando un despliegue falla.
**No probado en entorno real**: el mecanismo existe y está verificado, pero
no hay evidencia de un rollback ejecutado.

> **Estado:** Activa (no probada en entorno real)
>
> **Responsable:** Infraestructura (asignación nominal pendiente — ver
> [`../reference/ownership.md`](../reference/ownership.md))
>
> **Audiencia:** operador con acceso al host de producción
>
> **Última verificación:** 2026-08-13 · **Verificado contra commit:** `fd9f7be`
>
> **Revisión recomendada:** con cada cambio de `docker-compose.prod.yml` o del entrypoint

## Principio

El despliegue se fija por **SHA inmutable** de la imagen
(`ghcr.io/alejandrotatum/cata_club-{backend,frontend}:<sha>`). Un rollback
es exactamente lo mismo que un despliegue, pero con el SHA anterior: se
baja la imagen previa del registro (sigue publicada, los SHAs no se borran)
y se reinicia el stack.

```bash
# SHA anterior a desplegar (el del commit previo a la regresión)
export IMAGE_TAG=<sha-anterior>

docker compose -f docker-compose.yml -f docker-compose.prod.yml pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Validar con los mismos pasos del runbook de despliegue:
[`deployment.md`](deployment.md) (§ Validación post-despliegue).

## Cuándo hacer rollback

- Healthchecks en rojo después del despliegue
  (`docker compose -f docker-compose.yml -f docker-compose.prod.yml ps -a`).
- Errores visibles en los logs (`docker compose ... logs --tail=200`).
- Regresión funcional confirmada contra el SHA nuevo.

Antes de rollback: anotar el SHA desplegado y el error observado — es el
insumo del postmortem ([`incident-response.md`](incident-response.md)).

## Rollback y base de datos

**El rollback de imágenes NO revierte la base de datos.** El entrypoint corre
`alembic upgrade head` en cada arranque (`set -eu`: migración fallida =
contenedor que no arranca), y **Alembic puede rechazar una base que el código
viejo no conoce**: si `alembic_version` quedó en una revisión más nueva que el
`head` de la imagen previa, `alembic upgrade head` aborta («Can't locate
revision») aunque el cambio sea aditivo. «Compatible» no garantiza que la
imagen previa arranque: el mecanismo falla antes de que la compatibilidad se
ponga a prueba.

**No desplegar una migración sin una estrategia de reversa probada** (elegir y ensayar antes del despliegue):

- **Compatibilidad forward/backward verificada** — la imagen previa arranca
  contra la base ya migrada, probada de punta a punta (no asumida).
- **Fix-forward** — corregir en el SHA nuevo y desplegar hacia adelante, sin
  volver a la imagen anterior.
- **Restore aislado probado** — restaurar la base desde un backup en un
  entorno desechable, verificado
  ([`backup-restore.md`](backup-restore.md)).

Si ninguna existe, **el rollback de imagen NO es una solución completa**:
quedarse en el SHA nuevo y corregir hacia adelante.

**No hay `alembic downgrade` automático en el arranque ni en el repo**: no
inventar un paso de downgrade que no existe. La restauración de base, si se
necesita, va por [`backup-restore.md`](backup-restore.md) — y como ese
mecanismo no existe todavía, la opción responsable es **no desplegar una
migración no reversible sin backup previo** (decisión pendiente en la lista
viva).

## Registro del incidente

Después de un rollback:

1. Confirmar el stack estable: `docker compose ... ps -a` y sondas.
2. Documentar en la lista viva
   ([`production-readiness.md`](production-readiness.md)): qué SHA falló,
   por qué, cuál se restauró.
3. Abrir el defecto con causa raíz antes de reintentar el despliegue.
