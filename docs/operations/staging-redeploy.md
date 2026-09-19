# Redeploy de staging

> **No es producción.** Este procedimiento usa datos reales de staging y exige el
> mismo cuidado de secretos y PII que producción. No lo ejecutes contra otro host.

- URL pública: <https://staging.cataclub.com/>
- Health: <https://staging.cataclub.com/api/health>
- Operador/host: el usuario y la IP viven en el repo privado de operaciones (`cata_club-docs`), no en este archivo público
- Acceso SSH del host y segundo operador: [provisioning.md](provisioning.md#segundo-operador-ssh-y-endurecimiento-del-host)
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
   26 minutos DESPUÉS que la migración**, en un PR separado (`d1016emailunico`
   se mergeó por el PR #1019, el script por el PR #1021): si staging todavía
   corre un SHA anterior al #1021, el script no existe dentro del contenedor y
   `exec` responde `No such file or directory`. Eso no es una falla del
   entorno, es el mismo orden invertido que atrapa el candado de
   `backend/tests/test_migraciones_no_referencian_scripts_inexistentes.py`. En
   ese caso corre
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

### Convención: un script de precheck citado por una migración debe existir antes

`d1016emailunico` citaba `scripts/detectar_correos_duplicados.py` en su
docstring y en su mensaje de aborto desde el momento en que se mergeó (PR
#1019), pero el script recién existió 26 minutos después, en un PR aparte
(#1021, issue #1070). No fue un problema de empaquetado -- los diffs ya
estaban separados -- sino de orden: una migración nunca debe citar un
script de `scripts/*.py` que todavía no existe en `main`.

La regla: si una migración de Alembic referencia un script de precheck o
remediación (en su docstring, un comentario o un mensaje de error), ese
script tiene que existir en `main` **antes** de mergear la migración que lo
cita, nunca después. El PR que agrega el script va primero, o ambos van en
el mismo PR -- pero jamás el script después.

Esto NO aplica a un script de remediación posterior al aborto (como
`scripts/remediar_rol_multiple.py`, que llegó en el mismo PR que
`e762rolunico` porque documenta cómo resolver a mano un caso que la
migración ya dejó registrado, no un precheck previo al deploy).

El candado `backend/tests/test_migraciones_no_referencian_scripts_inexistentes.py`
hace esta regla determinista: recorre `backend/alembic/versions/*.py`,
extrae toda referencia literal a `scripts/*.py` y falla si el archivo
citado no existe en el árbol.

## Ejecución en el host

El usuario y el host de staging los provee el operador desde el repo privado
de operaciones (`cata_club-docs`); este archivo público no los publica.
Sustituye los marcadores del ejemplo y confirma con `hostname` que conectaste
al host correcto antes de tocar nada:

```bash
ssh <usuario-staging>@<host-staging>
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

## Reprovisionar la base sin vaciar Cloudinary

Reprovisionar la base de datos de un entorno (restore desde backup, reset a
esquema vacío, etc.) sin vaciar también la carpeta de Cloudinary de ESE
entorno (`cloudinary_carpeta_comprobantes` / `cloudinary_carpeta_vouchers`)
deja archivos de la vida anterior de la base viviendo en el proveedor.

Desde el fix del issue #1327, el `public_id` de un comprobante ya no
depende solo del `id` de pago (`comprobante-{id:08d}`): incluye un sufijo
derivado de `fecha_validacion`, así que dos vidas de la misma base (que
reciclan los mismos ids autoincrementales) ya NO colisionan en el mismo
recurso de Cloudinary. Un pago nuevo nunca va a heredar en silencio la
identidad (nombre, cédula, teléfono) del PDF de un pago de otra vida.

Eso no vuelve gratis a los archivos huérfanos: cada reprovisionamiento sin
purga acumula en Cloudinary los recursos de la vida anterior, que siguen
costando almacenamiento y nunca se vuelven a referenciar desde la base
nueva. Antes de reprovisionar un entorno, purga (o migra a un `folder`
propio de esa vida) la carpeta de Cloudinary correspondiente, o documenta en
esta sección por qué se decidió no hacerlo.

Las tres carpetas se pueden fijar por ambiente con
`CLOUDINARY_CARPETA_COMPROBANTES`, `CLOUDINARY_CARPETA_VOUCHERS` y
`CLOUDINARY_CARPETA_FOTOS_PERFIL` en el `.env` del host (`docker-compose.yml`
las interpola, con el default compartido `cataclub/*` si no se fijan). Local
y staging comparten la misma cuenta de Cloudinary: desde la reprovisión del
2026-09-19, staging usa `cataclub-staging/*` para dejar de escribir en las
mismas rutas que desarrollo local. Las carpetas compartidas `cataclub/*` NO
se purgaron en ese momento -- los recursos que staging ya había subido ahí
quedan como huérfanos, documentados y aceptados, no un pendiente.

## Reprovisionar con base vacía

Procedimiento seguido el 2026-09-19 para reemplazar los datos de la ronda de
pruebas de septiembre (SHA `29a2437d`) por una base limpia en el mismo
redeploy que avanzó staging al SHA aprobado. No repite el flujo manual ni la
ejecución en el host de las secciones anteriores; asume que ya corriste esos
pasos hasta tener `IMAGE_TAG` verificado y `MIGRATION_COMPATIBILITY` resuelto
(ver [Flujo manual, siempre con SHA](#flujo-manual-siempre-con-sha) y
[Ejecución en el host](#ejecución-en-el-host)). Si el rango no trae
migraciones nuevas, exporta `MIGRATION_COMPATIBILITY=none` como en este caso.

1. En el checkout remoto (`/opt/cata-club`), `git fetch` y `git checkout
   <SHA-aprobado>`. `deploy.sh` nunca mueve el checkout por sí solo -- si el
   checkout queda desalineado del `IMAGE_TAG`, el preflight lo detecta (ver
   [Checkout o `.env` obsoletos](#checkout-o-env-obsoletos)), pero el paso en
   sí es manual.
2. Antes de tocar nada, guarda el primer admin para restaurarlo después:
   campos de `persona`, el hash de `usuario.contrasenia` y
   `correo_verificado`, en un archivo temporal con `umask 077` y sin
   imprimirlo nunca por pantalla ni por logs.
3. `docker compose down --remove-orphans` y luego
   `docker volume rm cata-club_cataclub_db_data cata-club_cataclub_redis_data`.
   No toques `caddy_data` ni `caddy_config`: ahí viven los certificados TLS y
   `down` sin `-v` ya los deja intactos.
4. Escribe `IMAGE_TAG=<SHA-aprobado>` en el `.env` del host. El preflight
   exige `.env` = `IMAGE_TAG` exportado = `git rev-parse HEAD`, así que este
   paso tiene que preceder a cualquier otro.
5. **Marca de reaprovisionamiento**: con `db` y `redis` abajo, mueve el
   puntero del ledger `/var/lib/cata-club/releases/current.env` a
   `current.env.pre-reprovision-<timestamp-UTC>` antes de correr
   `preflight-production.sh`. Es la única forma de que el preflight tome la
   rama de primer aprovisionamiento: con el puntero en su lugar y la base
   abajo, aborta porque «la base debería estar arriba»; con una base vacía
   arriba y el puntero viejo, aborta leyendo `alembic_version`. El puntero
   archivado queda como historial en el ledger; `record-release.sh` escribe
   el nuevo al final del deploy.
6. Corre `./scripts/deploy/deploy.sh` como en la ejecución normal del host.
   Con base vacía tolera la ausencia de backup pre-deploy, corre las
   migraciones desde cero y valida que runtime, `HEAD`, `IMAGE_TAG` y ledger
   queden alineados («Validaciones OK»).
7. Recrea el primer admin con `scripts/crear_primer_admin.py` vía
   `docker compose exec -e BOOTSTRAP_ADMIN_*` y una contraseña descartable, y
   después restaura la identidad real sin que nadie vea la contraseña:
   `UPDATE usuario SET contrasenia=<hash guardado>, correo_verificado=<valor
   guardado> WHERE id=1`. Si leíste los booleanos con `psql -A`, vienen como
   `t`/`f`: convertilos antes de reinyectarlos en el `UPDATE`.
8. Borra el archivo temporal del paso 2.

Corrida como `ssh <usuario-staging>@<host-staging> 'bash -s' < script.sh`,
este procedimiento se corta a la mitad: `docker compose exec -T` y `psql`
dentro del script consumen el stdin del pipe, así que el resto del script
después del primer `exec` nunca llega a ejecutarse. Copia el script al host
y correlo ahí con `< /dev/null`.

## Última verificación

Actualiza esta sección en el mismo PR que sigue a cada redeploy. Quedó sin tocar
entre `76fe1eca` (2026-08-30) y `77db42c3` (2026-09-03), y el rango derivado de
ella pasó a ser 131 commits y 8 migraciones cuando los reales eran 23 y 2.

- SHA: `46c6bfb593eba21c376cb910ca9c6720fc26bb83`
- Rango de migración: ninguna pendiente; head en `p1146recses`
  (`MIGRATION_COMPATIBILITY=none`). 23 commits desde el redeploy anterior
  (`29a2437d`, que llevaba los datos de la ronda de pruebas de septiembre),
  sin archivos nuevos bajo `backend/alembic/versions/` en ese rango.
- Este redeploy fue además un reaprovisionamiento con base vacía: ver
  [Reprovisionar con base vacía](#reprovisionar-con-base-vacía) para el
  procedimiento completo (marca de reaprovisionamiento, snapshot/restauración
  del primer admin por hash, y la trampa de correr el script por un pipe SSH).
- Evidencia: 8 servicios saludables, Alembic `p1146recses` confirmado en el
  contenedor y en `alembic_version`, `https://staging.cataclub.com/health/ready`
  respondiendo `{"estado":"listo","postgres":"ok","redis":"ok"}` a través del
  borde, `celery inspect ping` con 1 nodo, conteos en base (1 usuario, 1
  persona, 0 pagos, 0 comprobantes) consistentes con la base vacía
  reaprovisionada, carpetas de Cloudinary verificadas dentro del contenedor de
  backend y el ledger con `46c6bfb….env` alineado. Nota conocida y no
  bloqueante: `crear_primer_admin.py` imprime un traceback cosmético de
  passlib/bcrypt (`__about__`) al hashear la contraseña descartable. Fecha:
  2026-09-19.
