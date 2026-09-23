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

Antes de un release, el checkout y `IMAGE_TAG` deben apuntar al mismo commit
completo. Fija el tag desde el checkout (nunca desde un valor copiado de un
runbook) y declara el resultado de la revisión de migraciones:

```bash
export IMAGE_TAG="$(git rev-parse HEAD)"
export MIGRATION_COMPATIBILITY=none  # o backward-compatible
./scripts/ops/preflight-production.sh
./scripts/deploy/deploy.sh
```

`preflight-production.sh` solo lee la configuración: exige `.env`, comprueba que
`git rev-parse HEAD` sea exactamente `IMAGE_TAG`, valida el render de Compose,
deriva la imagen del servicio `backend` y comprueba que Docker esté disponible y
que el backup lógico esté dentro del RPO. El registro (GHCR actualmente) y el
repositorio de imagen son una decisión del proyecto en `docker-compose.yml`, no
una constante de los scripts; la imagen resuelta queda en el registro de release
junto con el SHA. `deploy.sh` primero toma un backup pre-deploy (`backup-db.sh`)
mientras la base todavía corre con el esquema anterior — las migraciones Alembic
se ejecutan en cada arranque del backend y no existen down-migrations, así que
ese dump es el único camino de vuelta de datos. Después vuelve a ejecutar el
preflight, descarga esa imagen configurada, arranca el stack, comprueba que el
runtime coincida con `HEAD`, refresca el borde público, valida health/readiness y
registra la clase de migración y la fecha en un registro por SHA y en
`current.env`. Al registrar, persiste el mismo `IMAGE_TAG` en el `.env` del
proyecto y verifica `runtime = HEAD = IMAGE_TAG = ledger`; un desvío aborta sin
considerarse un release válido. Ese registro lleva **exactamente una**
`IMAGE_REFERENCE`: la del servicio `backend`, resuelta desde `config --format
json`. `rollback-release.sh` también actualiza `.env` al SHA registrado que
restaura.

**Visibilidad de las imágenes.** Las imágenes de GHCR son públicas por decisión
registrada el 2026-09-07 (#1073), no por omisión. El repositorio de código ya es
público y las imágenes solo contienen su build: las variables `NEXT_PUBLIC_*`
que lleva el frontend son públicas por definición y ningún secreto entra en la
imagen (viajan por `.env` en el host). Hacerlas privadas obligaría a un
`docker login` con token de solo lectura en el host y a un preflight que aborte
si falta, más piezas que fallan solas de madrugada por una ganancia nula. La
decisión se revisa si el repositorio pasa a privado o si alguna imagen empieza
a incluir material que no esté ya en el repositorio.

### Remediar un checkout o `.env` obsoleto

Si el preflight falla por desalineación, detente: no ejecutes `pull/up` manual ni
edites el ledger. Verifica el SHA aprobado con `git fetch origin main`, vuelve al
commit exacto con `git switch --detach <SHA-aprobado>`, y actualiza solo el tag
del archivo local: `sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=<SHA-aprobado>/" .env`.
Confirma que `git rev-parse HEAD` y `sed -n 's/^IMAGE_TAG=//p' .env` impriman el
mismo SHA y repite el preflight. Si el checkout está sucio, el commit no tiene CI
exitoso o no puedes demostrar la igualdad, conserva los logs y escala el caso.

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

## Segundo operador SSH y endurecimiento del host

> **Estado: registro de ejecución parcial — 2026-09-17 (#1065).** Ejecutado
> contra el host de staging: Etapa 0 (línea base, solo lectura), Etapa 4
> (fail2ban instalado y verificado con smoke adaptado) y Etapa 5 en su
> Alternativa A (sudo con contraseña; `NOPASSWD` removido). Etapas 1–3
> (segunda clave de operador) quedan **pendientes** hasta que exista un
> segundo operador real: #1065 permanece abierto por ese criterio. Los datos
> reales (usuario, IP, fingerprints) viven en el repo privado de operaciones
> (`cata_club-docs`); acá solo hay placeholders. Cada etapa lista su
> verificación y su vuelta atrás: entre etapas, el host queda en el estado
> anterior.

La regla que ordena todo el runbook: **nunca cerrar la sesión que funciona**.
Toda la operación se hace con la sesión conocida y verificada abierta en una
terminal, y cualquier acceso nuevo se prueba en una sesión independiente
antes de tocar algo existente.

| Regla fija | Por qué |
|---|---|
| La sesión conocida queda abierta durante toda la operación | es el camino de vuelta si la sesión nueva no entra |
| Solo `append` a `authorized_keys`, nunca `>` | un solo `>` trunca el archivo y puede dejar fuera al operador actual |
| Ninguna baja de acceso antes de probar la sesión nueva en otro equipo | quitar primero y probar después es el error que encierra a todo el mundo |
| Cero `systemctl restart/reload` de sshd en el camino normal | una sesión establecida no se arriesga por un cambio que no lo exige |
| Los valores reales van a `cata_club-docs`, no acá | este archivo es público |

### Etapa 0 — Línea base de solo lectura

Todo lo siguiente lee estado y no cambia nada (`sshd -t` valida sintaxis, no
recarga). Guardar la salida en el repo privado de operaciones: es la línea
base contra la que se compara al final.

```bash
ssh <usuario>@<host>          # sesión conocida: queda abierta
hostname && id                # confirmar host y usuario correctos
getent group sudo             # quiénes tienen sudo hoy
sudo -l                       # grants vigentes de este usuario
ls -ld ~ ~/.ssh ~/.ssh/authorized_keys 2>/dev/null
stat -c '%U %G %a' ~/.ssh ~/.ssh/authorized_keys 2>/dev/null
sudo sshd -T | grep -E '^(port|pubkeyauthentication|passwordauthentication|permitrootlogin) '
sudo sshd -t                  # 0 = configuración sshd válida
systemctl is-active ssh; systemctl is-enabled ssh
systemctl is-enabled ssh.socket 2>/dev/null || echo "sin socket activation"
systemctl is-active fail2ban 2>/dev/null || echo "fail2ban no instalado"
```

### Etapa 1 — Verificar la clave pública del segundo operador fuera de banda

La clave la genera el segundo operador en su propia máquina; la privada nunca
viaja. La pública viaja como texto, pero pegarla en un chat no prueba de
quién es: antes de escribir nada en el host, la huella se confirma por un
segundo canal (llamada de voz/video) contra lo que imprime la máquina del
operador.

```bash
# en la máquina del segundo operador
ssh-keygen -t ed25519
ssh-keygen -lf ~/.ssh/id_ed25519.pub    # anotar huella y comentario
```

Solo se continúa si la huella que llega al host es **carácter por carácter**
la que el operador leyó por el segundo canal.

### Etapa 2 — Agregar la clave: append y permisos

```bash
# en el host, con la sesión conocida abierta
install -d -m 700 -o <usuario-2> -g <grupo-2> /home/<usuario-2>/.ssh
sudo chown <usuario-2>:<grupo-2> /home/<usuario-2>/.ssh
sudo chmod 700 /home/<usuario-2>/.ssh
printf '%s\n' '<clave-publica-ed25519-del-operador-2>' \
  | sudo tee -a /home/<usuario-2>/.ssh/authorized_keys > /dev/null
sudo chown <usuario-2>:<grupo-2> /home/<usuario-2>/.ssh/authorized_keys
sudo chmod 600 /home/<usuario-2>/.ssh/authorized_keys
stat -c '%U %G %a' /home/<usuario-2>/.ssh /home/<usuario-2>/.ssh/authorized_keys
```

`tee -a` agrega; `tee` a secas sobrescribe. El dueño y el modo del directorio
y del archivo se imponen **explícitamente**, sin apoyarse en el comportamiento
de ninguna herramienta sobre rutas preexistentes, y se **verifican** con
`stat`: la salida debe ser exactamente `<usuario-2> <grupo-2> 700` para
`.ssh` y `<usuario-2> <grupo-2> 600` para `authorized_keys`. La verificación
importa porque sshd con `StrictModes` rechaza en silencio un `authorized_keys`
con dueño o permisos incorrectos: la sesión nueva fallaría y parecería un
problema de clave.

Vuelta atrás — quitar exactamente la línea agregada, a mano y por huella,
sin `sed` ni ningún borrado por regex (un comentario repetido o un patrón
amplio borra claves ajenas):

```bash
# 1) Backup dentro de ~/.ssh, con el mismo dueño y modo:
sudo cp -a /home/<usuario-2>/.ssh/authorized_keys \
           /home/<usuario-2>/.ssh/authorized_keys.bak-<fecha>
sudo chown <usuario-2>:<grupo-2> /home/<usuario-2>/.ssh/authorized_keys.bak-<fecha>
sudo chmod 600 /home/<usuario-2>/.ssh/authorized_keys.bak-<fecha>

# 2) Ubicar la clave por su HUELLA (la anotada en la Etapa 1).
#    Imprime una línea por clave; anotar cuál es la del operador-2:
sudo ssh-keygen -lf /home/<usuario-2>/.ssh/authorized_keys

# 3) Editar a mano y borrar SOLO esa entrada:
sudoedit /home/<usuario-2>/.ssh/authorized_keys
```

Verificación de la baja, antes de cerrar la etapa: `sudo ssh-keygen -lf`
vuelve a listar una clave menos, la huella del operador-2 desaparece y **todas
las demás huellas siguen idénticas**; un `sudo diff` contra el backup muestra
una única línea eliminada; `stat` sigue dando `600`/`<usuario-2>`; y la
**sesión que sobrevive** — la conocida de las etapas previas — entra igual
que antes.

### Etapa 3 — Probar la segunda sesión ANTES de quitar cualquier acceso

Desde **otra máquina o red**, terminal nueva:

```bash
ssh -i ~/.ssh/id_ed25519 <usuario-2>@<host>
hostname && id     # confirmar que entró al host correcto con el usuario correcto
```

Mientras esta sesión no entre, no se quita ninguna llave ni se cambia ninguna
configuración: se vuelve a la Etapa 2 y se verifica. Recién con la sesión
nueva probada, la baja del acceso anterior (si el dueño del club la decide)
es otra operación con el mismo esquema append → probar → verificar, nunca un
paso colateral de esta etapa.

### Etapa 4 — fail2ban: jail sshd para Ubuntu/systemd

En Ubuntu 20.04+ sshd escribe en el journal de systemd; en un host sin
`rsyslog` ni siquiera existe `/var/log/auth.log`, así que el backend por
defecto puede dejar el jail ciego. `backend = systemd` es el backend correcto
para esta familia. La configuración va en un **drop-in con nombre propio**
bajo `/etc/fail2ban/jail.d/`: un archivo nuevo acotado a este jail, que nunca
trunca ni reemplaza un `jail.local` preexistente —que puede llevar
configuración del operador— ni ningún archivo del paquete.

**Antes de escribir nada**: fail2ban puede estar ya instalado y configurado
(la Etapa 0 lo registró). La configuración existente se lee y se respalda una
copia en el registro privado de operaciones: jamás se trunca ni se reemplaza.

```bash
sudo ls -la /etc/fail2ban/jail.d/ 2>/dev/null
sudo cat /etc/fail2ban/jail.local 2>/dev/null
sudo grep -rn '^\[sshd\]' /etc/fail2ban/jail.d/ /etc/fail2ban/jail.local 2>/dev/null
```

Si algún archivo ya define o habilita `sshd`, la etapa se detiene ahí:
superponer un drop-in sobre un jail ya configurado es una decisión que se
revisa con esa configuración a la vista, no un paso colateral.

Instalación — el drop-in se niega a pisar un archivo existente, y la
configuración efectiva se valida **antes** de tocar el servicio:

```bash
sudo apt-get update && sudo apt-get install -y fail2ban
sudo test ! -e /etc/fail2ban/jail.d/sshd-journal.local \
  || { echo 'ABORTAR: el drop-in ya existe'; exit 1; }
sudo tee /etc/fail2ban/jail.d/sshd-journal.local > /dev/null <<'EOF'
[sshd]
enabled = true
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
bantime.increment = true
bantime.maxtime = 1w
ignoreip = 127.0.0.1/8 ::1
EOF
sudo fail2ban-client -t \
  && sudo systemctl enable fail2ban \
  && sudo systemctl restart fail2ban
```

Validación (todas antes de dar el jail por bueno):

```bash
sudo systemctl status fail2ban --no-pager
sudo fail2ban-client status sshd          # debe listar el jail "sshd"
sudo journalctl _COMM=sshd --since -30m --no-pager | tail -n 5
```

Smoke funcional — **obligatorio, no opcional**, desde un cliente desechable:
`maxretry` intentos con contraseña errada deben incrementar `Total failed` en
`fail2ban-client status sshd`. Si queda en `0`, el jail está ciego y no
debió considerarse instalado. Si el propio smoke baneó al cliente de prueba:
`sudo fail2ban-client set sshd unbanip <ip-de-prueba>` (o `sudo fail2ban-client
unban --all`) — la sesión conocida no se toca.

**Smoke en un host sin password auth (ejecutado 2026-09-17).** Con
`passwordauthentication no` la sonda de contraseña errada es imposible, y
una clave errónea sobre un usuario **válido** solo deja `Connection closed
by authenticating user`, que el filtro ignora en `mode = normal` (la cuenta
recién en `aggressive`): eso no es un jail ciego, es la sonda equivocada.
La sonda correcta acá son intentos con usuario inexistente, que loguean
`Invalid user ... from <ip>` y sí cuentan. Ejecutado: 3 intentos
(`ssh -o PreferredAuthentications=none <usuario-inexistente>@<host>`)
subieron `Total failed` de 2 a 5 sin banear la IP del operador (< maxretry),
el ruido de fondo siguió subiendo solo (2→8 en minutos) y el `journalmatch`
`_SYSTEMD_UNIT=sshd.service` matchea vía alias aunque Ubuntu loguee bajo
`ssh.service`. El pipeline de acción se probó sin arriesgar la IP del
operador: ban manual de `192.0.2.10` (RFC 5737) presente en el set nftables
`addr-set-sshd` del kernel y unban limpio.

**Socket activation: mecanismo no verificado, sin remedio automático.** Si la
Etapa 0 mostró `ssh.socket` habilitado, este runbook **no afirma** que esa
modalidad deje al backend `systemd` del jail sin leer nada en esta versión
del paquete ni en este host: la interacción real no fue verificada. El
detector es el smoke de arriba, obligatorio en todos los casos. Si el smoke
pasa, no se toca nada. Si el smoke queda en `0`, **no se deshabilita
`ssh.socket` como remedio por defecto**: primero se releva el estado
efectivo,

```bash
sudo fail2ban-client status sshd
sudo fail2ban-client get sshd journalmatch 2>/dev/null || true
sudo systemctl status ssh ssh.socket --no-pager
sudo systemctl list-units 'ssh*' --no-pager
sudo journalctl _COMM=sshd --since -30m --no-pager | tail -n 20
```

y con ese relevamiento la etapa **se detiene**: un cambio sobre el servicio
SSH del host — por ejemplo pasar de socket a servicio — es una corrección
específica de ese host, revisada de antemano y ejecutada con consola fuera de
banda del proveedor a mano. Este runbook no la prescribe: no hay ningún paso
que reinicie o reconfigure sshd, y **no se garantizan sesiones sin
interrupción**.

Vuelta atrás — revierte SOLO lo que esta etapa creó y devuelve el servicio
al estado registrado en la Etapa 0:

```bash
sudo fail2ban-client set sshd unbanip <ip-de-prueba>   # si el smoke baneó
sudo rm /etc/fail2ban/jail.d/sshd-journal.local        # SOLO el drop-in creado acá
```

Devolver el servicio al estado exacto de la Etapa 0:

- estaba **activo**: `sudo systemctl restart fail2ban` (recarga sin el
  drop-in) y `sudo systemctl disable fail2ban` solo si `is-enabled` dio
  `disabled`;
- estaba **inactivo** y esta etapa lo activó: `sudo systemctl disable --now
  fail2ban`.

Si esta etapa instaló el paquete y la Etapa 0 lo registraba ausente, removerlo
es una decisión que se registra en `cata_club-docs`. Sobre una instalación
**preexistente** jamás: `apt-get remove --purge fail2ban` destruiría
configuración que este runbook no creó.

### Etapa 5 — Política de sudo: resuelta como Alternativa A (2026-09-17)

> **RESUELTA Y EJECUTADA (#1065, 2026-09-17): Alternativa A.** El dueño
> eligió sudo con contraseña. La contraseña de la cuenta de deploy la setea
> el dueño **pegándola desde su gestor** (nunca tipeando a ciegas: ver el
> registro de ejecución), el archivo `/etc/sudoers.d/deploy` se respalda y su
> única línea se reemplaza por un comentario con motivo e issue; `visudo -c`
debe dar OK antes de cerrar la sesión y `sudo -n true` debe fallar. El día
> a día de `scripts/` no usa sudo (grupo `docker` más rutas propias), así que
> A no agrega fricción a la automatización. La Alternativa B queda abajo
> como referencia para si aparece operación privilegiada desatendida.

**Alternativa A — sudo con contraseña** (default Ubuntu). Sumar al segundo
operador al grupo `sudo` (`sudo adduser <usuario-2> sudo`): cada acción
privilegiada pide su propia contraseña y cada comando queda registrado en el
journal. Simple, auditado por defecto, sin editar sudoers. El costo: el
perímetro de seguridad es la contraseña de la cuenta, y toda automatización
necesita un humano delante.

**Alternativa B — wrappers angostos auditados.** Sudoers que permite solo
comandos específicos, envueltos en scripts **de root, no escribibles por el
usuario**, más logging:

```text
# /etc/sudoers.d/<nombre> — editado SOLO con: sudo visudo -f /etc/sudoers.d/<nombre>
Defaults logfile=/var/log/sudo.log
<usuario-2> ALL=(root) /usr/local/sbin/<wrapper>, /usr/local/sbin/<wrapper-2>
```

Reglas duras de la alternativa B: los wrappers viven bajo `/usr/local/sbin`,
`root:root`, modo `0755`; **nunca** bajo `/home` ni bajo ninguna ruta
escribible por el usuario autorizado (un script escribible por quien lo
ejecuta como root es escalada directa); se valida con `sudo visudo -c` antes
de cerrar la sesión; opcionalmente `Defaults log_output` + `sudoreplay` para
auditar sesiones completas. El costo: mantenimiento — cada comando operativo
nuevo exige wrapper, entrada de sudoers y revisión.

**Lo que ninguna alternativa admite.** No crear grants — con o sin
`NOPASSWD` — para `docker`/`docker compose`, `tee`, `chmod`/`chown`,
editores, gestores de paquetes (`apt`/`dpkg`), `su`, shells, ni para ningún
script en ruta escribible por el usuario. Cada uno de esos binarios permite
obtener root completo (`docker run -v /:/host` monta el filesystem entero,
`tee` escribe `/etc/sudoers`, `apt` ejecuta hooks de instalación): el grant
sería «sudo total con pasos extra y peor auditoría». Un grant así no
endurece el host — disimula el problema.

### Cuándo detenerse

Ante cualquier resultado inesperado — la sesión nueva no entra, `visudo -c`
falla, el jail queda ciego en el smoke — se conserva la sesión conocida, se
revierte la etapa con su vuelta atrás documentada y se escala el caso en
`cata_club-docs` con el relevamiento ya efectuado. Registro del 2026-09-17:
Etapas 0, 4 y 5A ejecutadas y verificadas; Etapas 1–3 (segunda clave)
pendientes de un segundo operador real, y #1065 permanece abierto por ese
criterio.

### Registro de ejecución (2026-09-17, #1065)

- **Etapa 0**: línea base registrada arriba. `(ALL) NOPASSWD: ALL` vía
  `/etc/sudoers.d/deploy`; contraseña de `deploy` bloqueada (`L`);
  `ssh.socket` habilitado con `ssh.service` activo; fail2ban ausente;
  2268 intentos fallidos de SSH en 24 h.
- **Etapa 4**: fail2ban 1.0.2 instalado, drop-in `sshd-journal.local` con
  guard anti-pisar y `fail2ban-client -t` OK, `enable`+`restart`, smoke
  adaptado contado en vivo (+3 sondas invalid-user, ruido de fondo 2→8) y
  acción probada con ban/unban manual de `192.0.2.10` (RFC 5737) visible
  en el set nftables `addr-set-sshd`. `ssh.socket` nunca se tocó: el smoke
  pasó y ningún remedio hizo falta.
- **Etapa 5A**: contraseña de `deploy` seteada por el dueño; backup del
  sudoers en `/root/deploy.sudoers.bak-20260917` y línea `NOPASSWD`
  reemplazada por comentario. `visudo -c` OK en todos los archivos,
  permisos `root root 440`, `sudo -n true` falla y `sudo -k id` devuelve
  `uid=0(root)` desde una sesión nueva.
- **Incidente y recuperación**: la primera contraseña seteada no coincidía
  con el gestor (tipeo a ciegas en prompts interactivos) y, con `NOPASSWD`
  ya removido, no había sudo in-band para re-setearla. Recuperación
  one-shot autorizada por el dueño vía `docker` (el grupo `docker` es
  root-equivalente): `docker run --rm -i -v /:/host alpine:3 chroot /host
  /usr/sbin/chpasswd` con la contraseña pegada a ciegas desde el gestor.
  Uso puntual y registrado; la equivalencia docker↔root sigue vigente
  mientras la cuenta de deploy esté en el grupo `docker`, y el
  endurecimiento de sudo no la elimina. Lección: las contraseñas se setean
  pegando desde el gestor, nunca tipeando a ciegas.

## Primer administrador (una sola vez, tras el primer deploy)

Una base recién migrada no tiene ningún usuario: el seed solo corre con
`AMBIENTE=development`, el registro público crea usuarios sin rol y asignar
roles exige un administrador existente. El bootstrap rompe ese ciclo:

```bash
docker compose exec \
  -e BOOTSTRAP_ADMIN_EMAIL=duenio@club.com \
  -e BOOTSTRAP_ADMIN_PASSWORD='<contraseña fuerte>' \
  -e BOOTSTRAP_ADMIN_CEDULA='<cédula real del propietario>' \
  -e BOOTSTRAP_ADMIN_TELEFONO='<celular real del propietario>' \
  backend uv run python scripts/crear_primer_admin.py
```

Exige una contraseña de 12+ caracteres (rechaza las publicadas en el seed),
crea persona + usuario + rol en una transacción y se niega si ya existe un
ADMINISTRADOR — repetirlo es inofensivo. Los siguientes administradores se
asignan desde la aplicación con esta cuenta.

`BOOTSTRAP_ADMIN_CEDULA` y `BOOTSTRAP_ADMIN_TELEFONO` son **obligatorias** y
se validan contra la regla real del dominio antes de escribir nada: la cédula
necesita 10 dígitos con provincia existente (01-24 o 30) y dígito verificador
correcto; el teléfono, 10 dígitos empezando en `09` (celular) o 9 empezando en
`0` (fijo), sin espacios ni separadores. El teléfono era opcional y tenía como
default `0000000000`, que no es un teléfono válido (issue #828): un dato de
identidad se pide, no se inventa. Si alguna no calza, el script se niega
diciendo cuál corregir y no deja rastro en la base.

## Límite conocido: staging

Este repositorio no describe ningún entorno de *staging*. Los únicos
despliegues que puede documentar son el de producción (`docker-compose.yml` +
`docker-compose.prod.yml`, vía `preflight-production.sh` y `deploy.sh`) y el de
QA local (`docker-compose.qa.yml`, vía `make qa-up`). Si existe un staging, su
suministro de secretos no está versionado acá y hay que tratarlo con el mismo
procedimiento de producción, confirmando a mano dónde vive su `.env`.

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
cualquiera de las identidades descifra. **`install-cron` exige un segundo
destinatario** (issue #791) — con una sola identidad, perderla (droplet
robado, gestor de contraseñas comprometido) vuelve irrecuperable **todo** el
histórico de backups a la vez. Las dos identidades privadas van en gestores de
contraseñas distintos, no en la misma caja fuerte.

Alternativa por entorno: `BACKUP_AGE_RECIPIENTS='age1... age1...'`. Sirve para
una corrida manual, pero **no** para el cron, que no hereda el shell del
operador. Por eso el camino recomendado es el archivo.

`install-cron` verifica que el archivo exista, que tenga al menos dos
destinatarios y que `age` esté instalado antes de tocar el crontab. Con un
solo destinatario configurado, el backup de las 03:30 no falla —
`backup-db.sh` sigue cifrando y escribiendo el artefacto— pero deja un AVISO
en su log; instalar el cron con esa configuración incompleta sí se rechaza,
porque ahí el operador todavía está en la terminal para corregirlo.
`deploy` aborta si el backup pre-deploy no puede cifrar: sin backup
recuperable no se corren migraciones, que no tienen vuelta atrás.

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
objeto remoto. Solo entonces publica atómicamente un recibo no secreto ligado al
nombre, tamaño y SHA del dump. A las 07:00 la frescura exige ese recibo cuando
B2 está activado; ausente, viejo o discordante bloquea el `&&` del heartbeat.
Con la réplica desactivada (el default) queda explícito el contrato local. Una
subida o verificación fallida hace fallar la corrida entera y no crea ni avanza
el recibo; el artefacto local se conserva en cualquier caso. El restore remoto
es un drill/gate separado: no entra en el cron ni lleva una identidad privada age
al host.

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
