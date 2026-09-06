# Redeploy de staging

> **No es producción.** Este procedimiento usa datos reales de staging y exige el
> mismo cuidado de secretos y PII que producción. No lo ejecutes contra otro host.

- URL pública: <https://staging.cataclub.com/>
- Health: <https://staging.cataclub.com/api/health>
- Operador/host: `deploy@104.248.115.57`
- Checkout remoto: `/opt/cata-club`

**Qué corre staging ahora mismo lo dice el propio staging, no este archivo.** El
endpoint de health devuelve el SHA desplegado, y esa es la única fuente que no se
desactualiza sola:

```bash
curl --fail --silent https://staging.cataclub.com/api/health
# {"status":"ok","sha":"<sha-desplegado>"}
```

Deriva de ahí el rango real (`git log --oneline <sha-desplegado>..HEAD` y
`git diff --name-only --diff-filter=A <sha-desplegado>..HEAD --
backend/alembic/versions/`). La sección «Última verificación» del final es una
foto del último redeploy documentado: sirve como evidencia de que el
procedimiento funcionó, **no** como estado actual. Si alguien desplegó sin
actualizarla, creerle infla el rango y con él la evaluación de riesgo.

## Flujo manual, siempre con SHA

1. En una máquina segura, parte de un checkout limpio. Verifica el commit objetivo
   y CI de `origin/main`; no uses `latest` ni copies un SHA mutable de esta página:

   ```bash
   git fetch origin main
   export IMAGE_TAG="$(git rev-parse origin/main)"
   git show -s --format='%H %s' "$IMAGE_TAG"
   gh run list --workflow ci.yml --branch main --commit "$IMAGE_TAG" --limit 1 \
     --json status,conclusion,headSha
   ```

   Continúa solo si `headSha` coincide exactamente y `conclusion` es `success`.
   Confirma los dos manifiestos exactos publicados por CI:

   ```bash
   docker manifest inspect "ghcr.io/alejandrotatum/cata_club-backend:${IMAGE_TAG}"
   docker manifest inspect "ghcr.io/alejandrotatum/cata_club-frontend:${IMAGE_TAG}"
   ```

2. El host debe tener Docker + Compose, el checkout en `/opt/cata-club` en el
   SHA aprobado, `.env` local no versionado y `CORS_ORIGENES`/`DOMINIO` de staging.
   El `IMAGE_TAG` del `.env` debe ser exactamente `git rev-parse HEAD`; el
   detente si el checkout está sucio; el preflight aborta si el checkout o el
   `.env` están obsoletos. Nunca pegues secretos en comandos, issues o este archivo.

3. Antes de migrar, confirma que existe un backup cifrado reciente y que ya pasó
   el restore-check en un entorno desechable. La identidad privada permanece en
   la máquina del operador, por ejemplo `~/.config/cataclub/backup-age-identity.txt`;
   **nunca la copies al servidor**. Ejemplo del check ya verificado:

   ```bash
   ./scripts/backup/restore-check.sh /ruta/al/backup.dump.age \
     --expect-revision 780ef12115e6 \
     --identity ~/.config/cataclub/backup-age-identity.txt
   ```

4. Clasifica la migración antes de tocar el host: `none`,
   `backward-compatible` o `manual-review-required`. El rango se deriva del SHA
   que sirve staging (ver arriba), nunca de este ejemplo. En el último redeploy
   documentado el rango fue `780ef12115e6->d1016emailunico->f1023correobtrim` y
   se clasificó `backward-compatible`. Si es manual, crea fuera del repositorio
   el artefacto exacto exigido por [provisioning.md](provisioning.md), con estos
   campos y valores ligados al SHA:

   ```text
   IMAGE_TAG=<sha-de-imagen>
   MIGRATION_RANGE=780ef12115e6->d1016emailunico->f1023correobtrim
   CURRENT_REVISION=780ef12115e6
   PENDING_MIGRATIONS=d1016emailunico,f1023correobtrim
   RESTORE_CHECK=passed
   MAINTENANCE_WINDOW=planned
   APPROVED_BY=<identificador-del-revisor>
   APPROVED_AT=<YYYY-MM-DDTHH:MM:SSZ>
   EXPIRES_AT=<YYYY-MM-DDTHH:MM:SSZ>
   ```

   No inventes campos ni ejecutes shell desde él. Usa exactamente:

   ```bash
   export MIGRATION_COMPATIBILITY=manual-review-required
   export MIGRATION_APPROVAL_FILE=/ruta/aprobacion.env
   ```

   `provisioning.md` es la fuente de verdad de formato y validaciones. `none` o
   `backward-compatible` no requieren aprobación; ante cualquier duda, detente.

5. Precheck de roles: antes y después de `e762rolunico`, revisa las cuentas que
   la migración registre como multirol. Cero duplicados es condición de salida.
   La **única** remediación autorizada es el script, primero en seco y solo con
   decisión explícita del dueño del club:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T backend \
     uv run python scripts/remediar_rol_multiple.py --usuario-id <id> --keep-role <ROL>
   # repetir con --aplicar únicamente tras revisar la salida
   ```

6. Precheck de correos duplicados, obligatorio si el rango incluye
   `d1016emailunico` o `f1023correobtrim`. Las dos migraciones crean un índice
   ÚNICO sobre `lower(btrim(correo))` y **abortan sin tocar nada** si encuentran
   una colisión preexistente, así que fallan seguras; este precheck no es la red,
   es el tiempo para reconciliar antes de que el deploy se detenga a mitad de
   camino.

   El gate vive en `backend/scripts/detectar_correos_duplicados.py`, pero **llegó
   con el mismo PR que la migración** (#1021): si staging todavía corre un SHA
   anterior, el script no existe dentro del contenedor y `exec` responde
   `No such file or directory`. Eso no es una falla del entorno. En ese caso corre
   la consulta equivalente, que usa la misma clave canónica que la migración
   (`_CLAVE_CANONICA = "lower(btrim(correo))"`) y devuelve solo conteos, sin
   volcar ningún correo:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T db \
     sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F "|" -c "SELECT
       (SELECT count(*) FROM usuario),
       (SELECT count(*) FROM (SELECT lower(btrim(correo)) k FROM usuario
          GROUP BY 1 HAVING count(*)>1) x),
       (SELECT count(*) FROM usuario WHERE correo <> lower(btrim(correo)));"'
   ```

   La segunda columna debe ser `0`. Si no lo es, **detente**: hay que decidir a
   mano qué cuenta es la real. Ninguna se elige ni se fusiona automáticamente.

## Ejecución en el host

```bash
ssh deploy@104.248.115.57
cd /opt/cata-club
export IMAGE_TAG=<SHA-verificado>
export MIGRATION_COMPATIBILITY=<none|backward-compatible|manual-review-required>
# Para manual-review-required, exporta también MIGRATION_APPROVAL_FILE.
./scripts/ops/preflight-production.sh
./scripts/deploy/deploy.sh
```

`deploy.sh` toma el backup pre-deploy cifrado, repite preflight, valida el
manifiesto, hace `pull`, valida el `Caddyfile`, recrea los siete servicios,
refresca el borde público, verifica que las imágenes runtime coincidan con
`HEAD`, prueba health/readiness y registra el release. Al registrar, escribe
el mismo SHA en `.env` y `current.env`, y vuelve a comprobar la alineación.
No saltes los scripts con un `compose pull/up` manual.
En primer aprovisionamiento tolera la ausencia de dump; después exige frescura
(RPO por defecto: 26 h).

El **refresco del borde** es un paso propio porque `up -d` no recrea `caddy`
cuando solo cambia el contenido del `Caddyfile` bind-mounteado, y Caddy compila
ese archivo una sola vez al arrancar: sin esto, el checkout nuevo del host queda
sin activar y el borde sigue sirviendo la configuración vieja. El deploy valida
el `Caddyfile` a través de Compose (para que tenga `DOMINIO`/`ACME_EMAIL`),
recrea **solo** `caddy` con `--force-recreate --no-deps` —db, redis, backend,
frontend y Celery no se reinician—, espera su healthcheck y verifica que
`/health/ready` devuelva **JSON** pasando por el borde. Nunca usa `down`, `-v`
ni `--renew-anon-volumes`: `caddy_data`, `caddy_config` y los certificados TLS
se conservan. Si el `Caddyfile` no valida, el deploy aborta antes de tocar el
contenedor que está sirviendo.

`current.env` queda con **una sola** `IMAGE_REFERENCE`, la del servicio
`backend`; si aparece más de una línea, no despliegues y revisá el registro.

### Checkout o `.env` obsoletos

Si el preflight informa que `Git HEAD` no coincide con `IMAGE_TAG`, no lo
fuerces ni ejecutes Compose manualmente. En el checkout remoto, revisa el
estado y actualiza únicamente al commit aprobado (`git fetch origin main` y
`git switch --detach <SHA-aprobado>`). Después corrige el archivo local sin
secretos: `sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=<SHA-aprobado>/" .env`, vuelve a
ejecutar el preflight y confirma que `.env` y `git rev-parse HEAD` impriman el
mismo SHA. Si no puedes demostrar esa igualdad, detente y conserva los logs.

## Postchecks y Beat

```bash
curl --fail --silent https://staging.cataclub.com/api/health
curl --fail --silent https://staging.cataclub.com/ >/dev/null
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps -a
docker compose -f docker-compose.yml -f docker-compose.prod.yml config --images
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T backend uv run alembic current
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T db sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select version_num from alembic_version"'
cat /var/lib/cata-club/releases/current.env
./scripts/ops/check-backup-freshness.sh --max-age-hours 26
```

Los siete servicios deben estar `healthy`; confirma además worker con `inspect
ping`, Beat con su healthcheck/mtime y logs recientes sin errores:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T celery-worker \
  uv run celery -A app.infraestructura.tareas.celery_app inspect ping
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs --since=10m celery-beat celery-worker
# Solo con una fila de prueba aprobada: fuerza un dispatch y confirma su consumo.
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T celery-worker \
  uv run celery -A app.infraestructura.tareas.celery_app call \
  app.infraestructura.tareas.verificacion_correo_tareas.despachar_verificaciones_pendientes
```

Verifica el dispatch de una tarea controlada y su consumo en worker según la
ventana aprobada; no dispares correos reales accidentalmente. El despliegue
probado dejó Beat operativo, dispatch correcto, cero duplicados y restore OK.

## Fallos, rollback y datos

- Si falla SHA, TLS, imagen, migración, release, backup, schema, health, Beat o
  dispatch: **detente**, conserva logs y no repitas a ciegas.
- No existe `alembic downgrade`. Un rollback solo revierte imágenes a un SHA
  registrado y compatible, con aprobación explícita:
  `./scripts/ops/rollback-release.sh <sha-anterior> --confirm-rollback`;
  prepara también el plan de restore. Una release manual no admite rollback
  automático.
- Nunca muestres contraseñas, tokens, `.env`, dumps ni PII; el backup contiene
  datos médicos y de menores. La identidad age privada solo se trae al restore.
- Los dumps `cataclub_*.dump` antiguos pueden estar en texto plano: siguen siendo
  una exposición aunque los nuevos sean `.dump.age`. Sigue el procedimiento de
  cifrado, restore y eliminación segura de [provisioning.md](provisioning.md).

## Última verificación

Actualiza esta sección en el mismo PR que sigue a cada redeploy. Quedó sin tocar
entre `76fe1eca` (2026-08-30) y `77db42c3` (2026-09-03), y el rango derivado de
ella pasó a ser 131 commits y 8 migraciones cuando los reales eran 23 y 2.

- SHA: `e25e8d44ca26952f30ba1df0a3139fa5f2c64daf`
- Rango de migración: `780ef12115e6->d1016emailunico->f1023correobtrim`,
  clasificado `backward-compatible`.
- Evidencia: 7 servicios saludables, Alembic `f1023correobtrim` confirmado en el
  contenedor y en `alembic_version`, índice único efectivo
  (`ix_usuario_correo_lower` sobre `lower(btrim((correo)::text))`), precheck de
  correos con 0 colisiones sobre 13 usuarios, restore-check en entorno desechable
  OK contra `780ef12115e6`, health por el borde sirviendo el SHA desplegado,
  landing HTTP 200 y `celery inspect ping` con 1 nodo. Fecha: 2026-09-06.
