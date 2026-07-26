# Runbook: recuperación de una base de datos de desarrollo drifted

## Por qué existe este runbook

La base de datos de desarrollo (`cata_club-db-1`) quedó con un
`alembic_version` fantasma: `21d79a1b7d64`. Esa revisión **no existe en
ningún archivo de migración de `backend/alembic/versions/` ni en ningún
commit del repositorio** — quedó registrada en la tabla `alembic_version`
sin que exista el archivo Python correspondiente (probablemente por un
`checkout` a una rama que tenía una migración no mergeada, seguido de un
`alembic upgrade head` que sí llegó a ejecutarse y stampear esa revisión
antes del cambio de rama).

La posición **real** era `9a8b7c6d5e4f`. Con `alembic_version` apuntando a
una revisión inexistente, Alembic no podía calcular el camino a `head`: ni
avanzar (no sabe desde dónde) ni retroceder (downgrade de una revisión que
no existe). El único camino confiable es el reset descrito abajo, no
reconciliar `alembic_version` a mano.

Una segunda base (`cata_club_alt-db-1`, de un worktree no relacionado)
quedó en otra posición drifted (`d4e5f6a7b8c9`). El mismo script recupera
cualquier base drifted de la misma forma, sin ramas por revisión: el
esquema completo se descarta y se reconstruye desde cero.

## Qué hace el reset

`backend/scripts/reset_dev_db.py` (invocado por `make db-reset`):

1. Valida que el reset esté permitido (`validar_reset_permitido`, ver más
   abajo) contra el `DATABASE_URL` resuelto por
   `app.soporte_transversal.configuracion.settings` — la misma fuente de
   configuración que usa el resto de la app y Alembic.
2. `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` sobre esa base.
   Esto borra **todos los datos y todas las tablas**, incluida la tabla
   `alembic_version` — no queda ningún rastro de la posición anterior.
3. `alembic upgrade head` desde el esquema vacío. Esto es lo que prueba,
   cada vez que se corre, que **las 16 migraciones aplican en orden desde
   cero** — la misma garantía que ahora también verifica el job de CI
   `migraciones-desde-cero` en cada PR.
4. `scripts/seed_dev_base.py` (idempotente) para recrear los datos mínimos
   de desarrollo (admin, entrenador, horarios, niveles de ranking, etc.).

## El guard: `validar_reset_permitido`

El reset es destructivo e irreversible, así que está protegido por dos
capas independientes:

1. **Allow-list de host, incondicional.** El host se parsea de
   `DATABASE_URL`. Si no está en `Settings.reset_hosts_permitidos`
   (default: `localhost`, `127.0.0.1`, `db` — el hostname real del
   servicio Postgres en `docker-compose.yml`), el reset se rechaza **sin
   importar `AMBIENTE` ni `--forzado`**. Esta capa es la que impide que un
   `.env` con `AMBIENTE=development` pero `DATABASE_URL` apuntando a un
   Postgres compartido o de staging destruya esa base por accidente.
   Si necesitás resetear otro Postgres local (ej. un `alt-db` de otro
   worktree), agregá su hostname explícitamente vía la variable de entorno
   `RESET_HOSTS_PERMITIDOS` — eso es un cambio de configuración auditable,
   no un flag de runtime.
   Como parte de esta misma capa incondicional, el guard también rechaza
   cualquier `DATABASE_URL` cuyo query string traiga `host`, `hostaddr` o
   `dbname`: el driver psycopg usa esos parámetros para sobrescribir el
   destino real de la conexión por encima del host/base del netloc, así
   que un `DATABASE_URL` como
   `postgresql+psycopg://user:pass@localhost:5432/db?host=prod.ejemplo.com`
   validaría `localhost` (permitido) pero conectaría de hecho a
   `prod.ejemplo.com`. No hay uso legítimo de esos parámetros en un reset
   de desarrollo, así que se rechazan de plano, también sin importar
   `--forzado`.
2. **Segundo factor fuera de `development`.** Si el host es válido y
   `AMBIENTE == "development"`, el reset procede (flujo normal). Si
   `AMBIENTE` es distinto, `--forzado` solo no alcanza: además hay que
   pasar `--confirmar-nombre=<nombre exacto de la base>`. Sin ese nombre
   exacto, el reset se rechaza.

Antes de ejecutar cualquier acción destructiva, el script imprime el host y
la base que va a destruir (`Resetting host=<host> db=<name>`).

## Cómo usarlo

```bash
# Reset normal en desarrollo (AMBIENTE=development en tu .env local):
make db-reset

# Ver qué haría, sin ejecutar nada destructivo:
cd backend && uv run python scripts/reset_dev_db.py --dry-run

# Fuera de development (ej. un ambiente de staging local con nombre propio):
cd backend && uv run python scripts/reset_dev_db.py \
    --forzado --confirmar-nombre=nombre_exacto_de_la_base
```

## Qué NO hace este reset

- No detecta ni repara el drift automáticamente — siempre reconstruye desde
  cero. No hay "modo fingerprint" que intente preservar los datos
  existentes: se evaluó y se descartó (ver D1 en el design de
  `backend-schema-recovery-and-api-repair`) porque una tabla de fingerprints
  se pudre con cada migración nueva y nunca prueba que el camino
  empty→head funciona.
- No toca Redis, Mailpit ni ningún otro servicio de `docker-compose.yml`.
- No es válido contra una base de producción real: la allow-list de host lo
  impide por diseño.
