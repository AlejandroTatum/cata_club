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
arranca el stack, refresca el borde público, valida health/readiness y registra
la clase de migración y la fecha en un registro por SHA y en `current.env`. Ese
registro lleva **exactamente una** `IMAGE_REFERENCE`: la del servicio `backend`,
resuelta desde `config --format json`. `rollback-release.sh` lo lee como
autoritativo, así que un release que no se pueda identificar con una sola
referencia aborta sin dejar registro.

### Refresco del borde público (Caddy) en cada deploy

`docker compose up -d` recrea un contenedor cuando cambia la **definición** de
su servicio, nunca cuando cambia el **contenido** de un archivo bind-mounteado.
El `Caddyfile` del host entra por `./Caddyfile:/etc/caddy/Caddyfile:ro` y Caddy
lo compila una sola vez, al arrancar: sin una recreación explícita, un `git
pull` que trae una ruta nueva no llega al borde y el contenedor sigue sirviendo
la configuración con la que arrancó.

Por eso `deploy.sh` hace, en este orden:

1. **Valida** el `Caddyfile` versionado en un contenedor descartable
   (`compose run --rm --no-deps --entrypoint caddy caddy validate`). Va por
   Compose para que el archivo se valide con el mismo `DOMINIO`/`ACME_EMAIL`
   que interpola en producción. Un archivo inválido aborta antes de recrear
   nada: el borde que está sirviendo no se toca.
2. **Recrea solo caddy** (`up -d --force-recreate --no-deps caddy`). `--no-deps`
   es obligatorio: db, redis, backend, frontend y los servicios de Celery **no**
   se reinician por este refresco. Nunca se usa `down`, `-v` ni
   `--renew-anon-volumes`, así que `caddy_data`, `caddy_config` y los
   certificados de Let's Encrypt sobreviven — su emisión tiene límite semanal.
3. **Espera** el healthcheck de `caddy` (`healthy`), o aborta.
4. **Verifica `/health/ready` a través del borde**, no solo dentro del
   contenedor backend, y exige **JSON**. Cuando la ruta del backend no está en
   la configuración activa, la petición cae en el catch-all del frontend y
   Next.js devuelve HTML: un chequeo que solo mirara el código de estado daría
   verde con el borde desactualizado. La sonda sale del contenedor backend hacia
   el servicio `caddy` presentando `DOMINIO` como SNI y Host, porque el bloque
   del sitio es `{$DOMINIO}`; `DOMINIO` se lee del mismo `.env` que `IMAGE_TAG`.

El paso 4 corre también con `./scripts/deploy/deploy.sh checks`.

En el **primer aprovisionamiento** la base nunca arrancó: no hay nada que
respaldar, el backup pre-deploy se omite con un aviso y la verificación de
frescura tolera la ausencia de dump solo durante ese deploy
(`BACKUP_TOLERATE_MISSING=1`). El camino documentado del día uno pasa sin que
el cron de backup haya corrido; a partir del segundo deploy, el backup
pre-deploy y el cron diario mantienen la alarma exigente.

## Primer administrador (una sola vez, tras el primer deploy)

Una base recién migrada no tiene ningún usuario: el seed solo corre con
`AMBIENTE=development`, el registro público crea usuarios sin rol y asignar
roles exige un administrador existente. El bootstrap rompe ese ciclo:

```bash
docker compose exec \
  -e BOOTSTRAP_ADMIN_EMAIL=duenio@club.com \
  -e BOOTSTRAP_ADMIN_PASSWORD='<contraseña fuerte>' \
  -e BOOTSTRAP_ADMIN_CEDULA=1712345678 \
  backend uv run python scripts/crear_primer_admin.py
```

Exige una contraseña de 12+ caracteres (rechaza las publicadas en el seed),
crea persona + usuario + rol en una transacción y se niega si ya existe un
ADMINISTRADOR — repetirlo es inofensivo. Los siguientes administradores se
asignan desde la aplicación con esta cuenta.

## Clave del proveedor del chatbot (`OPENCODE_API_KEY`)

El chatbot de FAQ consulta el gateway OpenCode Zen. El propietario entrega la
clave **fuera de banda**: nunca se pega en el repositorio, en un issue, en un
PR ni en un chat. El mecanismo aprobado es el mismo que el del resto de las
credenciales de este stack — el archivo `.env` del host, junto a los archivos
Compose, que `.gitignore` excluye y que un job de CI (`guard-secretos`) impide
trackear.

El chatbot es una función **opcional**. Sin clave, `ChatbotServicio` responde
desde su FAQ embebida y el resto de la aplicación no se ve afectada: el backend
arranca igual, y por eso `OPENCODE_API_KEY` no está en el fail-fast de
producción. Ese respaldo es también lo que hace peligrosa una clave *mal*
escrita: el usuario ve una respuesta plausible y nadie se entera de que el
asistente externo nunca se usó. De ahí el chequeo de abajo.

### Configuración inicial

1. Escribir la clave en el `.env` del host, en una línea propia, sin comillas
   y sin comentario pegado:

   ```
   OPENCODE_API_KEY=<clave-que-entrega-el-propietario>
   ```

2. Recrear los servicios Python para que tomen el nuevo entorno.
   `docker-compose.yml` declara `OPENCODE_API_KEY: ${OPENCODE_API_KEY:-}`
   dentro del ancla `&backend_env`, así que la variable llega a `backend`,
   `celery-worker` y `celery-beat` por interpolación de Compose — no hay que
   editar ningún archivo del repositorio para suministrarla:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d \
     backend celery-worker celery-beat
   ```

   Recrear el contenedor es obligatorio: el entorno de un contenedor se fija al
   crearlo, y un `restart` conserva el valor viejo.

### Verificación

```bash
docker compose exec backend uv run python scripts/verificar_chatbot.py --exigir
```

Corre dentro del proceso que atiende las consultas y mira exactamente el valor
que el servicio le pasa al cliente del gateway. No contacta la red, no gasta
tokens y **no imprime la clave**: solo el estado, una explicación y una huella
`sha256:` truncada del valor completo, que es de una sola vía.

| código | estado | qué significa |
| --- | --- | --- |
| 0 | `configurada` | llegó un valor plausible; que el proveedor lo acepte solo lo prueba una consulta real |
| 0 | `ausente` sin `--exigir` | no hay clave y el despliegue no la exige: el chatbot usa su FAQ local |
| 1 | `incompleta` | hay un valor que ninguna credencial puede tener (comillas, espacios, comentario pegado o el placeholder `<...>` de los ejemplos). Siempre es un error del operador |
| 2 | `ausente` con `--exigir` | el despliegue declara que el chatbot está habilitado y la clave no llegó |

`--exigir` es lo que separa los dos despliegues legítimos: usalo en el que
habilitó el asistente externo, omitilo en el que no. La comprobación de punta a
punta sigue siendo abrir el chat en la aplicación: si la respuesta empieza con
«El asistente externo no está disponible en este momento», se está sirviendo el
respaldo local.

### Rotación

Rotar es reemplazar el valor sin ventana de indisponibilidad visible: mientras
el contenedor no se recree, sigue sirviendo con la clave anterior.

1. Emitir la clave nueva en el proveedor y recibirla fuera de banda.
2. Anotar la huella actual (`verificar_chatbot.py` la imprime) — es lo que
   permite confirmar el cambio sin ver ningún secreto.
3. Reemplazar la línea en el `.env` del host y recrear los tres servicios
   Python con el mismo comando de la configuración inicial.
4. Volver a correr la verificación: el estado debe seguir en `configurada` y la
   huella debe ser **distinta** de la anotada. Si la huella no cambió, el
   contenedor no se recreó.
5. Recién entonces revocar la clave anterior en el proveedor.

### Revocación

1. Revocar la clave en el panel del proveedor. A partir de ese momento el
   gateway la rechaza y el chatbot sirve su FAQ local, sin errores visibles.
2. Vaciar la línea en el `.env` del host (`OPENCODE_API_KEY=`) o borrarla, y
   recrear los tres servicios Python.
3. Verificar **sin** `--exigir`: el estado esperado es `ausente` con código 0.
   Dejar la clave revocada en el `.env` deja el despliegue en `configurada` con
   un secreto muerto, que es justo lo que la revocación quiso evitar.

Si la clave se filtró, el orden se invierte: revocar primero en el proveedor y
después limpiar el `.env`.

### QA y otros entornos

El entorno de QA (`make qa-up`) hereda `OPENCODE_API_KEY` del `.env` de quien
lo levanta, a diferencia de las variables `SMTP_*`, que el overlay de QA fija a
Mailpit para que nunca use el proveedor del operador. Es deliberado: QA tiene
que poder ejercitar el chatbot real. La contrapartida es que las consultas de
QA se cobran contra la misma clave que producción.

**Límite conocido:** este repositorio no describe ningún entorno de *staging*.
Los únicos despliegues que puede documentar son el de producción
(`docker-compose.yml` + `docker-compose.prod.yml`, vía `preflight-production.sh`
y `deploy.sh`) y el de QA local (`docker-compose.qa.yml`, vía `make qa-up`). Si
existe un staging, su suministro de secretos no está versionado acá y hay que
tratarlo con el mismo procedimiento de producción, confirmando a mano dónde vive
su `.env`.

## Límite de compatibilidad de migraciones

Los scripts **no pueden inferir** si una migración Alembic admite rollback. La
persona que revisa la migración debe clasificarla explícitamente:

- `none`: no cambia el esquema.
- `backward-compatible`: cambio expand-only; la aplicación anterior continúa
  funcionando con el esquema ya actualizado.
- `manual-review-required`: cambio contractivo, datos transformados, downgrade
  necesario o cualquier duda.

Para `manual-review-required`, el preflight exige un artefacto de aprobación explícito, fuera del repositorio y sin secretos. Se entrega mediante `MIGRATION_APPROVAL_FILE=/ruta/aprobacion.env` y se lee como datos, nunca como código shell. Debe contener exactamente estos valores ligados al release:

```text
IMAGE_TAG=<sha-de-imagen>
MIGRATION_RANGE=c556legal01->e762rolunico->a790verifcorreo
CURRENT_REVISION=c556legal01
PENDING_MIGRATIONS=e762rolunico,a790verifcorreo
RESTORE_CHECK=passed
MAINTENANCE_WINDOW=planned
APPROVED_BY=<identificador-del-revisor>
APPROVED_AT=<YYYY-MM-DDTHH:MM:SSZ>
EXPIRES_AT=<YYYY-MM-DDTHH:MM:SSZ>
```

El preflight rechaza el archivo ausente, ilegible, mal formado, expirado o con cualquier valor distinto del `IMAGE_TAG`, la revisión actual o las dos migraciones pendientes. El comando de aprobación y despliegue es:

```bash
export IMAGE_TAG=<sha-de-imagen>
export MIGRATION_COMPATIBILITY=manual-review-required
export MIGRATION_APPROVAL_FILE=/ruta/aprobacion.env
./scripts/deploy/deploy.sh
```

### Preflight SMTP antes de recrear servicios

Antes de descargar imágenes o recrear servicios, el preflight resuelve y abre
una conexión TCP al `SMTP_HOST:SMTP_PORT` configurado y, cuando
`SMTP_STARTTLS=true`, completa el handshake STARTTLS SMTP. No autentica ni
envía correo: solo comprueba que el endpoint sea alcanzable. El timeout está
acotado (`SMTP_PREFLIGHT_TIMEOUT_SECONDS`, 10 segundos por defecto), los
diagnósticos no imprimen variables SMTP ni credenciales y cualquier fallo
bloquea el deploy antes de las migraciones.

DigitalOcean bloquea las conexiones SMTP salientes en los puertos 25, 465 y
587 en Droplets nuevos para reducir abuso y spam; consultar su
[explicación oficial](https://docs.digitalocean.com/support/why-is-smtp-blocked/).
Resend ofrece el puerto alternativo 2587 para SMTP con STARTTLS; ver su
[documentación oficial de SMTP](https://resend.com/docs/send-with-smtp).
Por eso `.env.production.example` recomienda `SMTP_PORT=2587` con
`SMTP_STARTTLS=true` para Resend en DigitalOcean. Es una recomendación de
proveedor/host, no una constante del script: otros proveedores pueden exigir
otro puerto, TLS implícito o una política distinta; configure y pruebe sus
valores reales.

`none` y `backward-compatible` no requieren este archivo. El rollback automático solo se
habilita si la release actual quedó registrada como `none` o
`backward-compatible`; nunca ejecuta `alembic downgrade`. Para una clase manual,
preparar y aprobar un plan de restauración/migración específico antes de tocar
producción.

## Backup y rollback

### Cifrado del backup (obligatorio antes de instalar el cron)

El dump es el padrón completo de los chicos del club: nombre, cédula, fecha de
nacimiento, tipo de sangre, alergias, condiciones médicas y contacto de
emergencia. La aplicación protege ese dato en tránsito; un dump en claro sobre
el disco lo devuelve entero a cualquiera que lea el filesystem del host (un
snapshot robado del VPS, un rsync mal apuntado, un admin que se va con su SSH).

Por eso `backup-db.sh` cifra con [`age`](https://github.com/FiloSottile/age) a
un **destinatario público**: el host guarda solo la clave pública, así que
puede escribir backups y no puede leer ninguno. Una passphrase simétrica no
serviría — tendría que vivir en el mismo host para que el cron corra sin nadie
mirando, y el atacante se llevaría el cifrado y la llave en el mismo viaje.

Generar el par **fuera del host** (en la máquina de quien opera):

```bash
age-keygen -o identidad-backup-cataclub.txt   # imprime "Public key: age1..."
```

- La **identidad privada** (`identidad-backup-cataclub.txt`) va a un gestor de
  contraseñas o a una caja fuerte offline, con al menos una segunda copia en
  otro lugar. **Nunca** al droplet, nunca al repositorio, nunca a un `.env`
  del stack: si vive en el host, el cifrado no protege de nada.
- La **clave pública** (`age1...`) sí va al host, porque no sirve para leer:

```bash
ssh <host>
sudo install -d -m 700 /etc/cataclub
printf '%s\n' 'age1...' | sudo tee /etc/cataclub/backup-recipients.txt
sudo apt-get install -y age
```

Se puede poner más de un destinatario, uno por línea: `age` cifra para todos y
cualquiera de las identidades descifra. Vale la pena una segunda clave de
resguardo — con una sola identidad, perderla vuelve irrecuperable **todo** el
histórico de backups a la vez.

Alternativa por entorno: `BACKUP_AGE_RECIPIENTS='age1... age1...'`. Sirve para
una corrida manual, pero **no** para el cron, que no hereda el shell del
operador. Por eso el camino recomendado es el archivo.

`install-cron` verifica que el archivo exista y que `age` esté instalado antes
de tocar el crontab, y `deploy` aborta si el backup pre-deploy no puede cifrar:
sin backup recuperable no se corren migraciones, que no tienen vuelta atrás.

### URL del heartbeat (obligatoria antes de instalar el cron)

El monitor externo del backup es un *dead-man's-switch*: UptimeRobot alerta
cuando el ping **deja de llegar** (ver `docs/operations/monitoring.md`). Esa es
la propiedad que lo hace útil — cubre el backup vencido, el cron desinstalado,
el disco lleno y el host apagado, ninguno de los cuales puede avisar por sí
mismo.

La URL del heartbeat lleva su token en el path, así que **es una credencial**:
quien la lea puede pingear a mano y dejar la alarma en verde para siempre con el
backup muerto. Por eso no va al crontab (que `crontab -l` lista sin
privilegios), no va al `.env` del stack y no la imprime ningún script.
`notify-heartbeat.sh` la lee de un archivo del sistema:

```bash
ssh <host>
sudo install -d -m 700 /etc/cataclub
printf '%s\n' 'https://heartbeat.uptimerobot.com/m...' | sudo tee /etc/cataclub/heartbeat-url.txt
sudo chmod 640 /etc/cataclub/heartbeat-url.txt
```

- Ruta por defecto: `/etc/cataclub/heartbeat-url.txt`, el mismo directorio `700`
  de root donde ya vive `backup-recipients.txt`. Se puede mover con
  `HEARTBEAT_URL_FILE`, pero el default es el que documenta este archivo.
- Permisos `640` y dueño root: el cron corre como el usuario del deploy, que
  necesita leerla; nadie más en el host tiene por qué poder.
- Debe empezar con `https://`. El script rechaza cualquier otra cosa: sobre
  `http` el token viaja en claro y lo lee cualquiera en el camino.

**No copiar este archivo a otro entorno.** Es el error más caro de esta pieza y
es silencioso en la dirección peligrosa: un staging con la URL de producción
pingea el heartbeat de producción todos los días, así que producción se ve verde
aunque su propio backup lleve semanas muerto. La alarma no se rompe — se
silencia, y nada lo delata. Cada entorno que quiera heartbeat necesita su propio
monitor en UptimeRobot y su propia URL; un entorno que no lo quiera simplemente
no instala el cron.

`install-cron` verifica que el archivo exista y tenga contenido antes de tocar
el crontab, y **aborta** si falta: instalar el cron sin el ping dejaría un
crontab que se ve correcto y una protección que no existe, sin nada que lo
diga.

### Crons

Instalar los crons solo después de que el operador haya revisado el crontab
que administra su host:

```bash
./scripts/deploy/deploy.sh install-cron --confirm-install-cron
```

Instala dos entradas: el backup diario (03:30) y la verificación de frescura
(`check-backup-freshness.sh --max-age-hours 26`, 07:00), que alerta si el dump
más reciente supera el RPO. La de las 07:00 encadena `notify-heartbeat.sh` con
`&&`, así que el ping sale **solo** si el chequeo salió 0: sin dump (exit 1) o
con el dump vencido (exit 2) el ping falta y el monitor externo alerta. Ambas
entradas escriben en el mismo log (`BACKUP_CRON_LOG`).

Ese log tiene que existir y ser escribible por el usuario que corre el cron. La
redirección `>> $BACKUP_CRON_LOG` se evalúa **antes** que el comando, así que un
log que no se puede abrir no degrada el monitoreo: lo apaga entero, backup y
alarma a la vez, y sin `MAILTO` ni MTA en el host nadie se entera. `/var/log` es
`drwxrwxr-x root:syslog` y el usuario del deploy no está en `syslog`, así que
por defecto **no puede crearlo**. `install-cron` lo verifica y aborta con el
comando exacto:

```bash
sudo install -o $(id -un) -g $(id -gn) -m 640 /dev/null /var/log/cataclub-backup.log
```

`backup-db.sh` escribe el artefacto de forma atómica en
`cataclub_<fecha>.dump.age` y no elimina backups: cuando se supera
`BACKUP_RETENTION`, avisa.

Al final de cada corrida invoca `scripts/backup/upload-b2.sh`, que replica ese
mismo artefacto **ya cifrado** a un object store S3-compatible y verifica el
objeto remoto. Con la réplica desactivada (el default) es un no-op y nada
cambia. Con la réplica activada, una subida o una verificación fallida hace
fallar la corrida entera: un backup que no salió del host no protege de la
pérdida del host. El artefacto local se conserva en cualquier caso.

La retención remota y la inmutabilidad (Object Lock, lifecycle) son
configuración del bucket y se administran en el proveedor, no desde acá — el
host no puede borrar su propio histórico, y eso es deliberado. El
aprovisionamiento del bucket, la application key y el archivo
`/etc/cataclub/b2-backup.env`, más el procedimiento de restauración desde la
réplica, están en [`backup-offsite.md`](backup-offsite.md).

En desarrollo local, sin destinatario configurado, el script **falla** y nombra
la salida: `BACKUP_ALLOW_PLAINTEXT=1` produce un `.dump` sin cifrar, solo apto
para datos de prueba. Ese escape se ignora y aborta en cualquier invocación
productiva (overlay `docker-compose.prod.yml` o `AMBIENTE=production`).

### Dumps en claro anteriores a este cambio

Los backups que ya estaban en `/var/backups/cataclub` **siguen en texto plano**;
cifrar de acá en adelante no los toca. Hasta que se resuelvan, el agujero sigue
abierto. `backup-db.sh` avisa en cada corrida mientras quede alguno.

Lo mínimo es conservar el más reciente ya cifrado y destruir el resto:

```bash
ssh <host>
cd /var/backups/cataclub
ls -1 cataclub_*.dump | tail -1        # confirmar cuál se conserva

# 1) Cifrar el que se conserva, contra la clave pública ya instalada.
age -R /etc/cataclub/backup-recipients.txt \
    -o cataclub_<fecha>.dump.age cataclub_<fecha>.dump

# 2) Probar que ese artefacto restaura ANTES de borrar el original.
./scripts/backup/restore-check.sh /var/backups/cataclub/cataclub_<fecha>.dump.age \
    --identity /ruta/traida/a/mano/identidad-backup-cataclub.txt

# 3) Recién entonces destruir TODOS los dumps en claro.
shred -u cataclub_*.dump
```

Un `rm` común deja los bloques recuperables; por eso `shred -u`. Sobre un disco
con SSD o copy-on-write ni `shred` garantiza el borrado físico: si el host ya
manejó estos dumps en claro, hay que asumir que también hay que rotar cualquier
snapshot o backup del proveedor que los contenga, y considerar destruir el
volumen. Verificar además si esos dumps se copiaron alguna vez a otra máquina.

Un rollback de aplicación exige una confirmación visible y usa un SHA conocido:

```bash
./scripts/ops/rollback-release.sh <sha-anterior> --confirm-rollback
```

No es un rollback de base de datos. Verificar las sondas y el comportamiento de
la aplicación después; si no hay un registro actual o la compatibilidad requiere
revisión manual, el script se niega a cambiar Compose.
