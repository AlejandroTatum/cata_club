# Cutover: del droplet de staging a producción (`cataclub.com`)

Decisión del dueño (2026-10-02): **un solo VPS**. El droplet que hoy sirve
staging se reconvierte **en el lugar** a producción para `cataclub.com`, con
`www.cataclub.com` redirigiendo al apex. Staging persistente se retira; QA
corre en local (`make qa-up`) o en droplets desechables creados desde un
snapshot (ver [paso 11](#11-recrear-un-staging-desechable-después)).

Este runbook **reemplaza** a [staging-redeploy.md](staging-redeploy.md) para este
host. Los datos de staging son datos de prueba y se **borran**; **ningún secreto
se hereda**: todos se rotan.

> **Qué NO está en este archivo.** El usuario SSH y la IP del host viven en el
> repo privado de operaciones (`cata_club-docs`, `operations/deployment.md`).
> Aquí se usan los marcadores `<usuario>` / `<host>`; exporta la IP solo en tu
> shell (`export HOST_IP=...`), nunca en un archivo versionado. Las credenciales
> (Resend, Cloudinary, Backblaze, UptimeRobot, contraseña del admin) tampoco se
> pegan en issues, commits ni este archivo.

Leyenda: 👤 **operador** (tú, con consola/ SSH) · 🤖 **agente** (puede ejecutarlo
sobre el checkout o por SSH si el operador lo autoriza). Cada paso termina con
**Esperado** y **Detente si**: si no se cumple, no avances y conserva los logs.

## Entradas que el operador debe tener a mano

- [ ] Acceso SSH al host y `sudo` (ver [provisioning.md](provisioning.md#segundo-operador-ssh-y-endurecimiento-del-host)).
- [ ] IP pública del host (repo `cata_club-docs`) → `HOST_IP`.
- [ ] SHA objetivo aprobado en `main` (CI verde + imágenes en GHCR).
- [ ] Cloudflare: acceso a la zona `cataclub.com`.
- [ ] Resend: **nueva** API key de producción (usuario SMTP `resend`, host y
      puerto 2587 según la cuenta) y remitente verificado para `SMTP_FROM`.
- [ ] Cloudinary: cloud name y **nuevas** API key/secret si la cuenta lo permite;
      carpetas de producción (`cataclub/*`, sin `staging`).
- [ ] Email de contacto ACME (`ACME_EMAIL`).
- [ ] Backblaze B2: bucket de producción y una **application key nueva** de
      mínimo privilegio (solo ese bucket) → [backup-offsite.md](backup-offsite.md).
- [ ] Dos claves públicas `age` (identidades privadas en gestores de contraseñas
      **distintos**, nunca en el host).
- [ ] UptimeRobot: acceso para borrar/crear monitores.
- [ ] Del dueño del club: correo, cédula, celular y contraseña del primer admin
      (12+ caracteres). **Nunca** se commitean.
- [ ] Cuenta de Google con permiso sobre el dominio (Search Console).
- [ ] Ventana de mantenimiento: el sitio de staging queda caído durante el cutover.

Atajo en todos los pasos del host:

```bash
cd /opt/cata-club
DC="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
```

---

## 1. Pre-cutover: SHA, backup final y snapshot

- [ ] **1.1 🤖 Verificar el SHA objetivo** (máquina segura, checkout limpio). Igual
  que en [staging-redeploy.md](staging-redeploy.md#flujo-manual-siempre-con-sha); nunca `latest`:

  ```bash
  git fetch origin main
  export IMAGE_TAG="$(git rev-parse origin/main)"
  git show -s --format='%H %s' "$IMAGE_TAG"
  gh run list --workflow ci.yml --branch main --commit "$IMAGE_TAG" --limit 1 \
    --json status,conclusion,headSha
  docker manifest inspect "ghcr.io/alejandrotatum/cata_club-backend:${IMAGE_TAG}" >/dev/null
  docker manifest inspect "ghcr.io/alejandrotatum/cata_club-frontend:${IMAGE_TAG}" >/dev/null
  ```

  **Esperado:** `headSha` = `IMAGE_TAG`, `conclusion: success`, ambos manifiestos
  existen. **Detente si:** CI no está verde o falta una imagen. El SHA debe incluir
  los cambios de esta rama (`check-prod-env.sh`, `/health/workers`, SEO, alias `www`).

- [ ] **1.2 👤 Backup final cifrado de staging** (por si el dueño pide algo de las
  pruebas; es dato de prueba, pero conserva el hábito):

  ```bash
  ssh <usuario>@<host>
  cd /opt/cata-club
  ./scripts/backup/backup-db.sh
  ls -1t /var/backups/cataclub | head
  ```

  **Esperado:** un `cataclub_<fecha>.dump.age` nuevo. **Detente si:** el backup
  falla; no hay valor en continuar sin entender por qué.

- [ ] **1.3 👤 Destruir los dumps en claro** antes del snapshot, para que el snapshot
  no los lleve ([provisioning.md](provisioning.md#dumps-en-claro-anteriores-a-este-cambio)):

  ```bash
  cd /var/backups/cataclub
  ls -1 cataclub_*.dump 2>/dev/null          # los que NO terminan en .age
  shred -u cataclub_*.dump 2>/dev/null || true
  ```

  **Esperado:** `ls cataclub_*.dump` ya no devuelve nada. Nota: `shred` no
  garantiza borrado físico en SSD/copy-on-write; por eso el paso siguiente.

- [ ] **1.4 👤 Snapshot opcional de DigitalOcean** (consola → Droplet → *Snapshots* →
  *Take snapshot*, nombre `staging-pre-cutover-<fecha>`). Sirve de base para el
  staging desechable del [paso 11](#11-recrear-un-staging-desechable-después) y como
  red de seguridad.

  **Rotación de snapshots:** (a) revisa en *Snapshots* si existe alguno **anterior**
  al cifrado de backups: pudo capturar dumps en claro; bórralo. (b) Pon fecha de
  borrado al snapshot nuevo (≤ 14 días tras un cutover exitoso); contiene `.env`
  de staging y datos de prueba. **Esperado:** snapshot en estado *Available*.
  **Detente si:** el droplet queda inaccesible tras el snapshot.

## 2. Parar el stack y limpiar el estado de staging

- [ ] **2.1 👤 Guardar el `.env` viejo** (solo para probar la rotación en el paso 3):

  ```bash
  cd /opt/cata-club
  umask 077 && cp .env ../cata-club.env.staging-old
  ```

  **Esperado:** `ls -l ../cata-club.env.staging-old` con modo `-rw-------`.
  Se destruye con `shred` en el paso 3.5. `$EDITOR`/`cp` no deben dejar otra copia.

- [ ] **2.2 👤 Parar el stack**, sin `-v` todavía:

  ```bash
  $DC down --remove-orphans
  $DC ps -a
  ```

  **Esperado:** sin contenedores. **Detente si:** queda alguno corriendo.

- [ ] **2.3 👤 Borrar volúmenes de datos** (`db` y `redis`). Comprueba los nombres
  reales antes; el prefijo es el del directorio de Compose:

  ```bash
  docker volume ls | grep cataclub
  docker volume rm cata-club_cataclub_db_data cata-club_cataclub_redis_data
  ```

  **Esperado:** ambos borrados. **No** toques `caddy_data` / `caddy_config`: son
  inofensivos conservarlos —guardan la cuenta ACME y certificados de
  `staging.cataclub.com`, que ya no se usarán; Caddy emite los de `cataclub.com`
  y `www.cataclub.com` aparte—. Si prefieres ceros absolutos, también puedes
  borrarlos, a costa de re-registrar la cuenta ACME (sin riesgo de rate limit
  por eso). **Detente si:** `docker volume rm` dice «volume in use».

- [ ] **2.4 👤 Quitar la configuración de cron de staging** (backup, frescura con el
  heartbeat de staging, y el snapshot del host si estaba instalado):

  ```bash
  crontab -l
  crontab -l | grep -v -e 'backup-db.sh' -e 'check-backup-freshness.sh' -e 'host-snapshot.sh' | crontab -
  sudo shred -u /etc/cataclub/heartbeat-url.txt
  crontab -l
  ```

  **Esperado:** el crontab final no contiene entradas de CataClub (conserva solo
  las ajenas); `heartbeat-url.txt` ya no existe. El heartbeat de staging **no**
  se reutiliza: producción tendrá el suyo (paso 7). **Detente si:** ves entradas
  que no reconoces; resuélvelas con el dueño del host antes de borrarlas.

- [ ] **2.5 👤 Marcar la frontera del ledger de releases** (la misma técnica de
  [staging-redeploy.md](staging-redeploy.md#reprovisionar-con-base-vacía)): sin
  esto el preflight aborta («la base debería estar arriba» o lee `alembic_version`
  de una base inexistente):

  ```bash
  sudo mv /var/lib/cata-club/releases/current.env \
    "/var/lib/cata-club/releases/current.env.pre-cutover-$(date -u +%Y%m%dT%H%M%SZ)"
  ls /var/lib/cata-club/releases/
  ```

  **Esperado:** el puntero archivado queda como historial; `record-release.sh`
  escribe el nuevo al final del primer deploy.

- [ ] **2.6 👤 Mover los backups viejos de staging fuera de `BACKUP_DIR`** para que
  el chequeo de frescura no los tome por backups de producción:

  ```bash
  sudo install -d -m 700 /var/backups/cataclub-staging-retired
  sudo mv /var/backups/cataclub/cataclub_*.dump.age /var/backups/cataclub-staging-retired/
  ```

  Bórralos más adelante (`shred -u`) cuando el dueño confirme que no los necesita.

- [ ] **2.7 🤖 Alinear el checkout con el SHA objetivo**:

  ```bash
  git status --short                       # debe estar limpio
  git fetch origin main
  git switch --detach <SHA-aprobado>
  git rev-parse HEAD
  ```

  **Detente si:** `git status` no está limpio o `HEAD` ≠ SHA aprobado.

## 3. Nuevo `.env` con secretos rotados

- [ ] **3.1 👤 Generar los secretos nuevos** (se muestran una sola vez; cópialos a
  tu gestor de contraseñas y al archivo del paso 3.2, no a un chat):

  ```bash
  openssl rand -hex 32     # JWT_SECRET_KEY
  openssl rand -hex 24     # POSTGRES_PASSWORD
  ```

  `POSTGRES_USER` debe ser distinto de `usuario` (la plantilla de producción lo
  exige): usa p. ej. `cataclub_prod`. La base se crea desde cero con estas
  credenciales (volumen nuevo del paso 2.3).

- [ ] **3.2 👤 Crear el `.env` nuevo** a partir de `.env.production.example`:

  ```bash
  cd /opt/cata-club
  install -m 600 .env.production.example .env
  $EDITOR .env
  ```

  Valores que **debes** fijar (el resto de la plantilla se completa según su comentario):

  ```dotenv
  IMAGE_TAG=<SHA-aprobado>                 # = git rev-parse HEAD
  AMBIENTE=production
  DOMINIO=cataclub.com
  DOMINIO_INDEXABLE=cataclub.com           # idéntico a DOMINIO, o producción sale noindex
  DOMINIO_ALIAS_WWW=www.cataclub.com
  ACME_EMAIL=<email-de-contacto>
  JWT_SECRET_KEY=<nuevo-paso-3.1>
  POSTGRES_USER=cataclub_prod
  POSTGRES_PASSWORD=<nuevo-paso-3.1>
  POSTGRES_DB=cataclub_db
  CORS_ORIGENES=https://cataclub.com
  FRONTEND_URL=https://cataclub.com
  SMTP_HOST=<host-resend>
  SMTP_PORT=2587
  SMTP_USER=<usuario-smtp>
  SMTP_PASSWORD=<api-key-resend-nueva>
  SMTP_FROM=no-reply@cataclub.com
  SMTP_STARTTLS=true
  CLOUDINARY_CLOUD_NAME=<cloud-name>
  CLOUDINARY_API_KEY=<nueva>
  CLOUDINARY_API_SECRET=<nueva>
  CLOUDINARY_CARPETA_COMPROBANTES=cataclub/comprobantes
  CLOUDINARY_CARPETA_VOUCHERS=cataclub/vouchers
  CLOUDINARY_CARPETA_FOTOS_PERFIL=cataclub/fotos_perfil
  ```

  Si ya existía, `OPENCODE_API_KEY` también se rota (opcional; vacío es válido).
  Sin comillas ni comentarios en la misma línea del valor.

  > `cataclub/*` es también el default de desarrollo local. Si dev y producción
  > comparten cuenta Cloudinary, usa carpetas propias (p. ej. `cataclub-prod/*`);
  > lo único que el validador prohíbe es `staging` en el nombre.

- [ ] **3.3 🤖 Validar y probar la rotación contra el `.env` viejo**:

  ```bash
  ./scripts/ops/check-prod-env.sh --env-file .env \
    --previous-env ../cata-club.env.staging-old
  ```

  **Esperado:** `check-prod-env OK: .env`. El script solo imprime **nombres** de
  variable, nunca valores; con `--previous-env` compara por hash que
  `JWT_SECRET_KEY` y `POSTGRES_PASSWORD` cambiaron. **Detente si:** sale con
  `ERROR:`; corrige y repite. Con `DOMINIO == DOMINIO_INDEXABLE` el preflight
  repite este chequeo solo (`PREVIOUS_ENV_FILE=<ruta>` lo incluye).

- [ ] **3.4 👤 Probar el render de Compose**:

  ```bash
  $DC config --quiet && echo "compose OK"
  git rev-parse HEAD; grep '^IMAGE_TAG=' .env | sed 's/IMAGE_TAG=//'
  ```

  **Esperado:** `compose OK` y los dos SHA idénticos.

- [ ] **3.5 👤 Destruir los `.env` viejos**:

  ```bash
  cd /opt/cata-club/..
  shred -u cata-club.env.staging-old
  ls cata-club.env.* 2>&1 | head -2
  ```

  **Esperado:** «No such file». Si ejecutaste 3.3 con éxito, ya no hay razón para
  conservarlos; recuerda borrar también copias fuera del host (gestor de
  contraseñas, notas) que contengan secretos de staging.

## 4. DNS en Cloudflare

- [ ] **4.1 👤 Antes de cambiar nada, mira qué sirven hoy el apex y `www`**:

  ```bash
  dig +short cataclub.com A
  dig +short www.cataclub.com A
  dig +short staging.cataclub.com A
  ```

  **Detente si:** el apex o `www` ya apuntan a algo que sirve un sitio vivo (p. ej.
  la landing en otro proveedor): consulta al dueño; el cutover lo reemplaza.

- [ ] **4.2 👤 Cloudflare → DNS → Records**, en la zona `cataclub.com`:

  | Tipo | Nombre | Contenido | Proxy |
  |---|---|---|---|
  | A | `@` | `<HOST_IP>` | **DNS only (nube gris)** |
  | A | `www` | `<HOST_IP>` | **DNS only (nube gris)** |

  Proxy **apagado**: Caddy emite el certificado Let's Encrypt directamente, y
  `X-Forwarded-For` / rate limit del backend asumen el cliente real
  (ver [Caddyfile](../../Caddyfile)). Quita cualquier registro AAAA o CNAME que
  compita con estos.

- [ ] **4.3 👤 Retirar el registro de staging**: elimina `A staging` (staging está
  retirado; dejarlo apunta un nombre a un host que ahora es producción y
  respondería con certificado inválido). Si más adelante levantas un staging
  desechable, créalo entonces ([paso 11](#11-recrear-un-staging-desechable-después)).

- [ ] **4.4 🤖 Esperar la propagación ANTES del primer deploy** (Let's Encrypt limita
  intentos fallidos; un deploy con DNS aún viejo quema cuota):

  ```bash
  for h in cataclub.com www.cataclub.com; do
    for ns in 1.1.1.1 8.8.8.8; do echo "$h @$ns: $(dig +short @$ns $h A)"; done
  done
  echo "esperado: $HOST_IP"
  ```

  **Esperado:** las 4 líneas muestran exactamente `HOST_IP`. **Detente si:**
  alguna difiere o está vacía: espera y repite; no despliegues.

  También verifica en la consola de DigitalOcean (Networking → Firewall) y/o `ufw`
  que **80/tcp y 443/tcp** estén abiertos: Let's Encrypt valida por HTTP-01.

## 5. Backups: destinatarios `age` y réplica B2

- [ ] **5.1 👤 Destinatarios `age`** (claves públicas, ≥ 2 distintas; las
  identidades privadas se quedan **fuera del host**):

  ```bash
  sudo install -d -m 750 /etc/cataclub
  printf '%s\n' 'age1...clave-1' | sudo tee /etc/cataclub/backup-recipients.txt >/dev/null
  printf '%s\n' 'age1...clave-2' | sudo tee -a /etc/cataclub/backup-recipients.txt >/dev/null
  sudo chmod 640 /etc/cataclub/backup-recipients.txt
  command -v age || sudo apt-get install -y age
  grep -vEc '^[[:space:]]*(#|$)' /etc/cataclub/backup-recipients.txt
  ```

  **Esperado:** `2` o más. **Detente si:** hay un solo destinatario: `install-cron`
  lo rechaza (issue #791). Genera pares nuevos; no reutilices los de staging si
  su identidad privada pudo estar en un lugar compartido.

- [ ] **5.2 👤 `b2-backup.env` de producción** con una application key **nueva** de
  mínimo privilegio (solo el bucket de producción). Instalación del cliente `aws`
  y formato exacto del archivo: [backup-offsite.md](backup-offsite.md#configuración-en-el-host):

  ```bash
  sudo install -o root -g "$(id -gn)" -m 640 /dev/null /etc/cataclub/b2-backup.env
  sudoedit /etc/cataclub/b2-backup.env
  #   BACKUP_B2_ENABLED=1
  #   BACKUP_B2_ENDPOINT=https://s3.<región>.backblazeb2.com
  #   BACKUP_B2_REGION=<región>
  #   BACKUP_B2_BUCKET=<bucket-de-producción>
  #   BACKUP_B2_PREFIX=cataclub/produccion
  #   BACKUP_B2_KEY_ID=<id-nuevo>
  #   BACKUP_B2_APPLICATION_KEY=<clave-nueva>
  ```

  La key de staging, si existía, se **revoca** en el panel de Backblaze.

- [ ] **5.3 🤖 Verificar sin tocar la red**:

  ```bash
  ./scripts/backup/upload-b2.sh --check-config
  ```

  **Esperado:** sale 0 sin errores de faltantes. **Detente si:** reporta variables
  faltantes, bucket no productivo o permisos del archivo.

## 6. Primer deploy

- [ ] **6.1 🤖 Preflight y deploy**:

  ```bash
  cd /opt/cata-club
  export IMAGE_TAG="$(git rev-parse HEAD)"
  export MIGRATION_COMPATIBILITY=none      # base vacía: migraciones desde cero
  ./scripts/ops/preflight-production.sh
  ./scripts/deploy/deploy.sh
  ```

  **Esperado:** el preflight corre `check-prod-env.sh` solo (porque
  `DOMINIO == DOMINIO_INDEXABLE`) y avisa «se asume primer aprovisionamiento»;
  `deploy.sh` tolera la ausencia de backup pre-deploy, corre Alembic desde
  cero, recrea los servicios, valida `runtime = HEAD = IMAGE_TAG = ledger` y
  termina con «Validaciones OK». **Detente si:** falla SHA, imagen, TLS,
  migración o release: no repitas a ciegas; clasifica el fallo
  (determinista / transitorio / heredado) y conserva `$DC logs`.
  El primer arranque pide los certificados; si falla, mira
  `$DC logs caddy` **antes** de reintentar (rate limit de Let's Encrypt).

- [ ] **6.2 🤖 Post-checks** (desde cualquier máquina, salvo el último):

  ```bash
  # Salud a través del borde
  curl -fsS https://cataclub.com/health/ready               # {"estado":"listo",...}
  curl -fsS https://cataclub.com/api/health                 # {"status":"ok","sha":"<IMAGE_TAG>"}
  # Latido de workers: el beat lo emite cada 60 s; puede tardar ~1-3 min tras el arranque
  curl -s -o /dev/null -w '%{http_code}\n' https://cataclub.com/health/workers   # 200

  # Indexable: el X-Robots-Tag NO debe aparecer en el apex
  curl -sI https://cataclub.com/ | grep -i '^x-robots-tag' && echo MAL || echo "ok: sin noindex"

  # www redirige al apex
  curl -sI https://www.cataclub.com/ | sed -n '1p;/^[Ll]ocation/p'   # 301 o 308 → https://cataclub.com/

  # robots y sitemap
  curl -fsS https://cataclub.com/robots.txt        # Allow: / ; Sitemap: https://cataclub.com/sitemap.xml
  curl -fsS https://cataclub.com/sitemap.xml | grep -o '<loc>[^<]*</loc>'   # todas con https://cataclub.com

  # /metrics NO es alcanzable desde el borde
  curl -s -o /dev/null -w '%{http_code}\n' https://cataclub.com/metrics     # 404

  # En el host: Celery y estado
  $DC ps -a
  $DC exec -T celery-worker \
    uv run celery -A app.infraestructura.tareas.celery_app inspect ping
  $DC exec -T backend uv run alembic current
  cat /var/lib/cata-club/releases/current.env
  ```

  **Esperado:** cada comentario `# …` de arriba. `robots.txt` **no** debe contener
  `Disallow: /` a secas (eso es el modo noindex por `DOMINIO_INDEXABLE` ausente);
  el sitemap lista URLs de `https://cataclub.com`, no de `www`. `ps` con todos los
  servicios `healthy`; `inspect ping` con 1 nodo. **Detente si:** aparece
  `X-Robots-Tag: noindex` (revisa `DOMINIO_INDEXABLE`; corrige el `.env`, recrea
  con `$DC up -d --force-recreate caddy frontend`), `/metrics` ≠ 404, o el sitemap
  muestra otro host.

- [ ] **6.3 👤 Pasar a modo ensayo (noindex)** apenas pasen los post-checks. El
  primer deploy corre indexable a propósito para que `check-prod-env.sh` valide
  el `.env` completo; ahora se oculta el sitio a los buscadores mientras dura el
  ensayo del [paso 8b](#8b-ensayo-silencioso-y-limpieza):

  ```bash
  sed -i 's/^DOMINIO_INDEXABLE=.*/DOMINIO_INDEXABLE=ensayo.invalid/' .env
  $DC up -d --force-recreate caddy frontend
  curl -sI https://cataclub.com/ | grep -i '^x-robots-tag'   # noindex, nofollow
  curl -fsS https://cataclub.com/robots.txt                  # Disallow: /
  ```

  **Esperado:** `X-Robots-Tag: noindex, nofollow` y `robots.txt` con `Disallow: /`.
  Con `DOMINIO_INDEXABLE` distinto de `DOMINIO` el preflight no repite
  `check-prod-env.sh`; es lo esperado durante el ensayo. **No** envíes el
  sitemap a Search Console todavía. **Detente si:** el apex sigue sin
  `X-Robots-Tag`.

## 7. UptimeRobot

- [ ] **7.1 👤 Borrar los monitores de staging** (los de `staging.cataclub.com` y su
  heartbeat de 24 h). Quedarían en rojo de inmediato (DNS retirado) y el heartbeat
  viejo ya no recibirá pings.

- [ ] **7.2 👤 Crear los monitores de producción** (ver [monitoring.md](monitoring.md#los-monitores)):

  | Monitor | Tipo | URL / período | Esperado |
  |---|---|---|---|
  | Readiness | HTTPS | `https://cataclub.com/health/ready`, cada 5 min | `200` |
  | Workers | HTTPS | `https://cataclub.com/health/workers`, cada 5 min | `200` |
  | Backup/Celery/memoria | Heartbeat | período 24 h con tolerancia (monitoring.md §2) | ping diario 07:00 |

- [ ] **7.3 👤 Escribir `heartbeat-url.txt`** con la URL **nueva** del heartbeat
  (es una credencial; nunca la del monitor de staging):

  ```bash
  printf '%s\n' 'https://heartbeat.uptimerobot.com/m...' | sudo tee /etc/cataclub/heartbeat-url.txt >/dev/null
  sudo chmod 640 /etc/cataclub/heartbeat-url.txt
  ```

- [ ] **7.4 🤖 Instalar los crons** (tras revisar `crontab -l`). El log debe existir y
  ser escribible por el usuario del deploy:

  ```bash
  sudo install -o $(id -un) -g $(id -gn) -m 640 /dev/null /var/log/cataclub-backup.log
  ./scripts/deploy/deploy.sh install-cron --confirm-install-cron
  crontab -l
  ```

  **Esperado:** dos entradas (backup 03:30, frescura+heartbeat 07:00). **Detente
  si:** aborta (falta destinatario, B2 mal configurado, log inescribible o
  `heartbeat-url.txt`): el mensaje trae el comando exacto.

## 8. Primer administrador y categorías

- [ ] **8.1 👤 Crear el primer admin** (el dueño entrega los datos fuera de banda;
  nada por argv ni al repo). La base recién migrada no tiene usuarios
  ([provisioning.md](provisioning.md#primer-administrador-una-sola-vez-tras-el-primer-deploy)):

  ```bash
  $DC exec \
    -e BOOTSTRAP_ADMIN_EMAIL='<correo>' \
    -e BOOTSTRAP_ADMIN_PASSWORD='<contraseña 12+ caracteres>' \
    -e BOOTSTRAP_ADMIN_CEDULA='<cédula real>' \
    -e BOOTSTRAP_ADMIN_TELEFONO='<celular real>' \
    backend uv run python scripts/crear_primer_admin.py
  ```

  **Esperado:** confirmación sin imprimir la contraseña. Repetirlo es inofensivo
  (se niega si ya hay un ADMINISTRADOR). Si la cédula/teléfono no validan, el
  script dice cuál corregir y no escribe nada. Un traceback cosmético de
  passlib/bcrypt (`__about__`) es conocido y no bloqueante. Limpia el historial
  de shell: `history -c` o ejecuta con `HISTCONTROL=ignorespace` y espacio inicial.

- [ ] **8.2 👤 Iniciar sesión y crear las categorías** en `/groups` («Nueva
  categoría»): `categoria_horario` **no se siembra** (migración `5b09fde49560`); sin
  categorías el club no puede cargar horarios ni asignar alumnos. **Esperado:**
  categorías visibles en `/groups`.

## 8b. Ensayo silencioso y limpieza

Producción ya corre en `cataclub.com`, oculta a los buscadores (paso 6.3) y sin
anunciar. Se prueba todo con servicios reales y después se borra lo de prueba.

- [ ] **8b.1 👤 Ensayo.** Recorre los flujos reales: registro, inscripción,
  pagos, correos (Resend entrega **de verdad**), subida de fotos (Cloudinary,
  carpetas de producción), panel de cada rol. Usa **solo correos y datos
  propios**; ningún dato de socios reales. Anota los hallazgos; un arreglo de
  código vuelve a pasar por PR, CI verde y redeploy con el SHA nuevo.
  **Detente si:** un flujo crítico falla; no se lanza con hallazgos abiertos.

- [ ] **8b.2 🤖 Borrar la base de prueba** y arrancar limpia (mismo patrón que
  los pasos 2 y 6):

  ```bash
  cd /opt/cata-club
  $DC down
  docker volume ls --format '{{.Name}}' | grep -E 'db_data|redis_data'
  docker volume rm <volumen_db_data> <volumen_redis_data>
  export IMAGE_TAG="$(git rev-parse HEAD)"
  export MIGRATION_COMPATIBILITY=none
  ./scripts/ops/preflight-production.sh
  ./scripts/deploy/deploy.sh
  ```

  Mueve fuera de `BACKUP_DIR` los dumps generados durante el ensayo (contienen
  datos de prueba), igual que los dumps de staging del paso 2. **No** borres el
  volumen de Caddy: conserva los certificados. **Esperado:** «Validaciones OK»
  y una base sin usuarios.

- [ ] **8b.3 👤 Borrar las fotos de prueba** en la consola de Cloudinary (carpetas
  de producción configuradas en `CLOUDINARY_CARPETA_*`). La base nueva ya no
  las referencia: si quedan, ocupan cuota para siempre.

- [ ] **8b.4 👤 Repetir el [paso 8](#8-primer-administrador-y-categorías)**:
  primer admin y categorías, ahora definitivos.

## 9. Google Search Console

Los pasos 9.1 y 9.2 pueden hacerse antes del cutover (no publican nada). El
resto es el **lanzamiento**:

- [ ] **9.0 👤 Volver a indexable**:

  ```bash
  sed -i 's/^DOMINIO_INDEXABLE=.*/DOMINIO_INDEXABLE=cataclub.com/' .env
  ./scripts/ops/check-prod-env.sh --env-file .env
  $DC up -d --force-recreate caddy frontend
  curl -sI https://cataclub.com/ | grep -i '^x-robots-tag' && echo MAL || echo "ok: sin noindex"
  ```

  **Esperado:** `check-prod-env OK` y `ok: sin noindex`. Recién entonces se
  anuncia el sitio al club.

- [ ] **9.1 👤 Propiedad de dominio**: Search Console → *Añadir propiedad* → *Dominio*
  → `cataclub.com`; copia el registro TXT.
- [ ] **9.2 👤 Cloudflare → DNS** → TXT en `@` con el valor de Google (DNS only).
  Verifica con `dig +short TXT cataclub.com`, luego pulsa *Verificar*.
- [ ] **9.3 👤 Enviar el sitemap**: *Sitemaps* → `https://cataclub.com/sitemap.xml`.
  **Esperado:** estado «Correcto».
- [ ] **9.4 👤 Inspección de URL** de `https://cataclub.com/` → *Solicitar
  indexación*. **Esperado:** «La URL está disponible para Google» (sin `noindex`).

El favicon (crest cuadrado) y los datos estructurados tardan **días** en reflejarse
en los resultados; no es un fallo. **Detente si:** Search Console reporta
`noindex` en la home: vuelve al paso 6.2.

## 10. Restore drill y rollback

- [ ] **10.1 👤 Primer dump de producción** (con la base viva y al menos el admin):

  ```bash
  cd /opt/cata-club
  ./scripts/backup/backup-db.sh
  ./scripts/ops/check-backup-freshness.sh --max-age-hours 26
  ```

  **Esperado:** `cataclub_<fecha>.dump.age` nuevo (y réplica a B2 verificada).

- [ ] **10.2 👤 Restore drill en una máquina del operador** (la identidad privada
  **nunca** va al host). Trae el dump con `scp` y ejecuta, con Docker disponible:

  ```bash
  REV="$(ssh <usuario>@<host> "cd /opt/cata-club && docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T backend uv run alembic current" | awk '{print $1}')"
  ./scripts/backup/restore-check.sh /ruta/al/cataclub_<fecha>.dump.age \
    --expect-revision "$REV" \
    --identity ~/.config/cataclub/backup-age-identity.txt
  ```

  **Esperado:** el script restaura en un contenedor efímero, valida
  `alembic_version` y lo destruye. **Detente si:** falla: producción no tiene un
  backup recuperable; arréglalo antes de aceptar datos reales.

- [ ] **10.3 Notas de rollback.**
  - No hay `alembic downgrade`. Un rollback de aplicación solo revierte imágenes a
    un SHA registrado y compatible:
    `./scripts/ops/rollback-release.sh <sha-anterior> --confirm-rollback`.
    El primer release de producción **no tiene** SHA anterior en el ledger nuevo
    (el archivado del paso 2.5 es de staging): si el primer deploy falla, se corrige
    hacia adelante o se vuelve a empezar desde el paso 2.
  - Volver a staging por completo implica restaurar el snapshot del paso 1.4 y
    revertir el DNS; úsalo solo dentro de la ventana de retención del snapshot.
  - Datos: restore desde backup cifrado, con aprobación explícita del dueño.
  - Borra el snapshot de DigitalOcean (o fija su fecha) y los
    `cataclub-staging-retired` cuando el cutover esté estable.

## 11. Recrear un staging desechable (después)

Para QA fuera de local, sin persistir datos ni apuntar al bucket/heartbeat de
producción:

- [ ] **11.1** DigitalOcean → *Snapshots* → `staging-pre-cutover-<fecha>` → *Create
  Droplet*. Genera `.env` **nuevo** (nada de producción) con:

  ```dotenv
  DOMINIO=staging.cataclub.com
  DOMINIO_INDEXABLE=cataclub.com        # distinto de DOMINIO → X-Robots-Tag: noindex
  # DOMINIO_ALIAS_WWW sin definir       # default www.localhost: no pide ningún certificado
  CORS_ORIGENES=https://staging.cataclub.com
  FRONTEND_URL=https://staging.cataclub.com
  CLOUDINARY_CARPETA_*=cataclub-staging/...
  ```

  Con `DOMINIO_INDEXABLE` distinto de `DOMINIO` (o ausente) el preflight **no**
  ejecuta `check-prod-env.sh`.
- [ ] **11.2** Cloudflare: `A staging → <ip-del-droplet-desechable>` (DNS only).
- [ ] **11.3** Sin `/etc/cataclub/heartbeat-url.txt` ni `b2-backup.env` de
  producción; no instales el cron (un heartbeat o bucket compartidos silencian
  alertas de producción: ver [provisioning.md](provisioning.md#url-del-heartbeat-obligatoria-antes-de-instalar-el-cron)).
- [ ] **11.4** Verifica `curl -sI https://staging.cataclub.com/ | grep -i x-robots-tag`
  → `noindex, nofollow`. Destruye el droplet al terminar.
