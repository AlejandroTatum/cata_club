# Controles de operación de producción

Estos scripts preparan un host con Docker Compose sin asumir un proveedor, una
cuenta cloud, un dominio o un gestor de secretos. El operador conserva las
credenciales fuera del repositorio y decide cómo aprovisionar la máquina.

## Contrato del host

El host debe tener Docker con el plugin Compose, un checkout del repositorio y
un archivo `.env` junto a los archivos Compose. Los defaults son
`STACK_DIR=/opt/cata-club`, `BACKUP_DIR=/var/backups/cataclub` y
`RELEASE_RECORD_DIR=/var/lib/cata-club/releases`; se pueden reemplazar con
variables de entorno. Ningún script crea credenciales ni las imprime.

Antes de un release, fijar un `IMAGE_TAG` hexadecimal inmutable y declarar el
resultado de la revisión de migraciones:

```bash
export IMAGE_TAG=<sha-de-imagen>
export MIGRATION_COMPATIBILITY=none  # o backward-compatible
./scripts/ops/preflight-production.sh
./scripts/deploy/deploy.sh
```

`preflight-production.sh` solo lee la configuración: exige `.env`, valida el
render de Compose, deriva la imagen del servicio `backend` y comprueba que Docker
esté disponible y que el backup lógico esté dentro del RPO. El registro (GHCR
actualmente) y el repositorio de imagen son una decisión del proyecto en
`docker-compose.yml`, no una constante de los scripts; la imagen resuelta queda
en el registro de release junto con el SHA. `deploy.sh` primero toma un backup
pre-deploy (`backup-db.sh`) mientras la base todavía corre con el esquema
anterior — las migraciones Alembic se ejecutan en cada arranque del backend y
no existen down-migrations, así que ese dump es el único camino de vuelta de
datos. Después vuelve a ejecutar el preflight, descarga esa imagen configurada,
arranca el stack, valida health/readiness y registra la clase de migración y la
fecha en un registro por SHA y en `current.env`.

En el **primer aprovisionamiento** la base nunca arrancó: no hay nada que
respaldar, el backup pre-deploy se omite con un aviso y la verificación de
frescura tolera la ausencia de dump solo durante ese deploy
(`BACKUP_TOLERATE_MISSING=1`). El camino documentado del día uno pasa sin que
el cron de backup haya corrido; a partir del segundo deploy, el backup
pre-deploy y el cron diario mantienen la alarma exigente.

## Límite de compatibilidad de migraciones

Los scripts **no pueden inferir** si una migración Alembic admite rollback. La
persona que revisa la migración debe clasificarla explícitamente:

- `none`: no cambia el esquema.
- `backward-compatible`: cambio expand-only; la aplicación anterior continúa
  funcionando con el esquema ya actualizado.
- `manual-review-required`: cambio contractivo, datos transformados, downgrade
  necesario o cualquier duda.

El preflight rechaza `manual-review-required`. El rollback automático solo se
habilita si la release actual quedó registrada como `none` o
`backward-compatible`; nunca ejecuta `alembic downgrade`. Para una clase manual,
preparar y aprobar un plan de restauración/migración específico antes de tocar
producción.

## Backup y rollback

Instalar los crons solo después de que el operador haya revisado el crontab
que administra su host:

```bash
./scripts/deploy/deploy.sh install-cron --confirm-install-cron
```

Instala dos entradas: el backup diario (03:30) y la verificación de frescura
(`check-backup-freshness.sh`, 07:00), que alerta si el dump más reciente supera
el RPO de 26 h. Ambas escriben en el mismo log (`BACKUP_CRON_LOG`).

`backup-db.sh` escribe el dump de forma atómica y no elimina backups: cuando se
supera `BACKUP_RETENTION`, avisa. La retención, cifrado y réplica fuera del host
son políticas del proveedor de almacenamiento y siguen pendientes de configurar.

Un rollback de aplicación exige una confirmación visible y usa un SHA conocido:

```bash
./scripts/ops/rollback-release.sh <sha-anterior> --confirm-rollback
```

No es un rollback de base de datos. Verificar las sondas y el comportamiento de
la aplicación después; si no hay un registro actual o la compatibilidad requiere
revisión manual, el script se niega a cambiar Compose.
