# Monitoring y alertas

El monitoreo externo se contrató con **UptimeRobot**. La decisión no es
técnica: es el proveedor que el club puede administrar sin nadie de guardia, con
plan gratuito suficiente para los dos monitores de abajo y notificación por
correo. El repositorio no guarda ninguna credencial suya; lo único que el host
conoce es la URL del heartbeat, en un archivo de root (ver
`docs/operations/provisioning.md`).

Las dos mitades se complementan y ninguna reemplaza a la otra:

- Un monitor que solo mira el sitio no sabe nada del backup.
- Un chequeo que solo corre en el host se muere junto con el host.

## Los dos monitores

### 1. Readiness HTTPS (¿la app puede atender?)

`https://<dominio>/health/ready`, cada 5 minutos, esperando `200`.

Caddy enruta ese path exacto a `backend:8000` (bloque `handle` del `Caddyfile`);
todo lo demás sigue yendo al frontend. Es la ÚNICA ruta del backend alcanzable
desde internet, y a propósito: `/health`, `/docs` y `/diagnostico/circuitos`
quedan afuera, esta última porque exige rol ADMINISTRADOR.

La respuesta es anónima y deliberadamente muda: `200` con `{"estado": "listo"}`
si Postgres y Redis contestan, `503` si no, sin decir cuál se cayó. Un
desconocido no aprende de qué dependencia depende el sistema.

El endpoint contesta por GET y por HEAD, con el mismo veredicto (HEAD no
devuelve cuerpo). El HEAD existe porque el plan gratuito de UptimeRobot sondea
con ese método y elegirlo es un control pago: sin un handler propio la sonda
recibía `405` (issue #862), porque FastAPI no deriva HEAD del GET.

### 2. Heartbeat de backup, Celery y memoria (¿siguen vivos?)

Un monitor tipo *heartbeat* (dead-man's-switch) con período de 24 h y tolerancia
suficiente para cubrir la corrida de las 07:00.

El cron de las 07:00 corre `check-backup-freshness.sh` y, **solo si sale 0**,
encadena `check-celery-health.sh` (issue #1061) y `check-memory.sh` (issue
#1071) y, **solo si los tres salen 0**, `notify-heartbeat.sh`, que pingea la
URL del heartbeat. El encadenamiento es `&&`, nunca `;`: con el dump ausente
(exit 1) o vencido (exit 2), con celery-worker/celery-beat `unhealthy` o con
la memoria al límite, el ping NO sale, y UptimeRobot alerta por la ausencia.

`check-celery-health.sh` reutiliza el mismo chequeo que ya gatea un
deploy/rollback (`check_celery` en `scripts/deploy/lib/post-checks.sh`): los
healthchecks de `docker-compose.yml` para celery-worker (`inspect ping -d`) y
celery-beat (freshness de `celerybeat-schedule`, refrescada cada 30s). El
sidecar `autoheal` (issue #1091) reinicia un contenedor que Compose deja
`unhealthy` para siempre fuera de Swarm, pero eso es reparación local: sin
este cron, nada externo se enteraba si igual quedaba enfermo entre
despliegues.

Que la alerta sea la AUSENCIA del ping es lo que hace que esto sirva. Cubre a la
vez el backup vencido, Celery atascado, la memoria al límite, el cron
desinstalado, el disco lleno y el host apagado — ninguno de los cuales puede
reportarse a sí mismo. Un
chequeo que tuviera que enviar su propia alerta se callaría en todos esos
casos.

La URL lleva el token en el path, así que es un secreto: no va al crontab (que
`crontab -l` lista sin privilegios) ni a ningún log. `notify-heartbeat.sh` la
lee de un archivo de root y no la imprime en ningún camino, ni siquiera al
fallar.

## Logs de contenedores

`docker-compose.prod.yml` declara `logging.driver: journald` en los ocho
servicios del render (issue #1067): con el driver por defecto de Docker
(`json-file`) el log vive DENTRO del filesystem efímero del contenedor, bajo
su ID -- y cada despliegue recrea `backend`/`frontend` (imagen nueva) y cada
cambio del `Caddyfile` recrea `caddy` (`refrescar_caddy`), así que un
`docker logs <contenedor>` después de un redeploy no muestra nada de antes
del último release. `journald` es un servicio del HOST: sobrevive al
`docker rm`/recreate porque no depende del ciclo de vida del contenedor.

Para consultar el log de un servicio, incluido el de un release anterior:

```
journalctl CONTAINER_NAME=<servicio> --since <ventana>
```

Por ejemplo, `journalctl CONTAINER_NAME=cata-club-backend-1 --since "48 hours ago"`.
`<servicio>` es el nombre del contenedor tal como lo asigna Compose
(`docker ps` lo confirma), no el nombre del servicio en el YAML.

El `Caddyfile` agrega además un bloque `log { output stdout }` en el sitio
único de producción: sin él, Caddy solo emitía sus propios logs de admin y
arranque, nunca el access log del borde (quién pidió qué y qué devolvió el
proxy). Con `journald` como driver, ese access log también persiste al
redeploy.

Lo que queda fuera de este repositorio: la retención real
(`SystemMaxUse`, `MaxRetentionSec` en `journald.conf`) es configuración del
host, y un destino centralizado fuera del host (por ejemplo un agregador
externo) queda fuera de alcance por decisión del dueño del proyecto.

## Memoria: medición y disparador de resize (issue #1071)

El único host tiene 1.9 GiB de RAM utilizables. Con `mem_limit` de Compose
nada más, cuando la memoria del host se agota el que actúa es el OOM killer
del kernel: `mem_limit` solo decide QUÉ contenedor cae primero dentro de su
propio cgroup, no reserva nada y no evita que el host entero se quede sin
memoria si la suma real de todos los servicios crece.

Medición tomada en el host de producción, de noche y sin carga, **antes de
agregar el swapfile de abajo** (2026-09-07 ~04:00 UTC):

```
               total        used        free      shared  buff/cache   available
Mem:           1.9Gi       1.1Gi       157Mi        25Mi       930Mi       870Mi
Swap:             0B          0B          0B

NAME                        MEM USAGE / LIMIT   MEM %
cata-club-caddy-1           16.23MiB / 96MiB    16.91%
cata-club-celery-worker-1   214MiB / 320MiB     66.87%
cata-club-frontend-1        97.28MiB / 256MiB   38.00%
cata-club-celery-beat-1     124.6MiB / 160MiB   77.86%
cata-club-backend-1         186.3MiB / 320MiB   58.23%
cata-club-redis-1           4.809MiB / 64MiB    7.51%
cata-club-db-1              55.89MiB / 320MiB   17.47%
```

`celery-beat` era el más ajustado del stack (78% en reposo, sin ningún pico de
tarea programada todavía) por eso subió su `mem_limit` de 160m a 224m (ver
`docker-compose.prod.yml`). La suma de todos los `mem_limit` de producción
pasó de 1568m a 1632m, todavía por debajo de los 2048m del droplet.

### Swapfile de 1 GiB como red de seguridad

El host tiene un swapfile de 1 GiB desde el 2026-09-07: no evita un pico de
memoria, pero lo convierte en lentitud en vez de en un OOM kill directo. Se
creó con:

```
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Con `vm.swappiness=10` en `/etc/sysctl.d/99-swappiness.conf` (`sudo sysctl -p
/etc/sysctl.d/99-swappiness.conf` para aplicarlo sin reiniciar): un swappiness
bajo hace que el kernel recurra al swap solo bajo presión real de memoria, no
para páginas frías de uso normal -- el swap es la red de seguridad, no la
memoria de trabajo cotidiana del stack.

**Decisión:** se mantiene el droplet de 2 GiB por ahora, con este swap como
colchón. El disparador para pasar al plan de 4 GiB (~20 USD/mes, solo
CPU/RAM, para que el cambio sea reversible) es cualquiera de estos dos, el que
ocurra primero:

- `check-memory.sh` falla (exit distinto de 0, y por lo tanto corta el
  heartbeat de las 07:00) durante **dos días consecutivos**.
- Un servicio queda OOM-killed **una sola vez**:
  `docker inspect --format '{{.State.OOMKilled}}' <contenedor>` devuelve
  `true`.

No hay una tercera condición: un solo fallo aislado de `check-memory.sh` (por
ejemplo, un pico puntual durante un despliegue) no dispara el resize por sí
solo.

## Señales disponibles en el host

- `scripts/ops/check-backup-freshness.sh --max-age-hours 26` sale `0` si existe
  un dump reciente, `1` si no existe y `2` si supera el RPO.
- `scripts/ops/check-celery-health.sh` sale `0` si celery-worker y celery-beat
  están `healthy` y el broker responde al ping de control; distinto de 0 si
  cualquiera de los dos está `unhealthy`, ausente o no responde (issue #1061).
- `scripts/ops/check-memory.sh` sale `0` si todos los contenedores en
  ejecución están por debajo del 90% de su `mem_limit` y la memoria disponible
  del host (`MemAvailable` de `/proc/meminfo`) está en o sobre el umbral
  (256 MiB por default, `--min-available-mb` para cambiarlo). Se encadena con
  `&&` antes de `notify-heartbeat.sh` en el cron de las 07:00, igual que
  `check-backup-freshness.sh` y `check-celery-health.sh`: un contenedor cerca
  de su límite o un host sin margen corta el ping, y la ausencia del ping es
  la alerta.
- `scripts/ops/notify-heartbeat.sh` pingea el heartbeat externo. Sale distinto
  de 0 si el archivo de la URL falta, está vacío o el ping no sale.
- `scripts/ops/preflight-production.sh` valida la configuración de Compose y la
  frescura del backup antes de un release.
- `scripts/deploy/deploy.sh checks` ejecuta las sondas internas de health y
  readiness, confirma que `/docs` no quedó expuesto y vuelve a comprobar el RPO.

De estos, el único que contacta a un tercero es `notify-heartbeat.sh`, y lo
único que le manda es el ping: un GET sin cuerpo, sin datos del club y sin nada
del estado del backup. Los demás no envían correo, webhooks ni datos a terceros
— exponen señales, y el scheduler del host o el proveedor externo deciden qué
hacer con ellas.

## Follow-ups obligatorios antes de depender de producción

1. ~~Configurar un monitor **fuera del host** contra el endpoint HTTPS público
   de readiness~~ — **hecho**: monitor 1 de arriba. Los destinatarios y la
   escalación se administran en UptimeRobot, no en este repositorio.
2. ~~Ejecutar `check-backup-freshness.sh` desde el scheduler elegido y probar
   una alerta por backup ausente/viejo~~ — **hecho**: el cron de las 07:00
   encadena el heartbeat, y su ausencia es la alerta. Verificado que con
   exit 1 y exit 2 el ping no sale.
3. **Mecanismo listo; falta configurarlo en producción.** `backup-db.sh`
   replica el artefacto ya cifrado a un object store S3-compatible y verifica
   el objeto remoto (`scripts/backup/upload-b2.sh`). Queda por hacer, y es
   trabajo de consola, no de repositorio: crear el bucket con Object Lock
   (retención por defecto 30 días) y lifecycle (~90 días), emitir una
   application key restringida a ese bucket **sin permiso de borrado**, y
   escribir `/etc/cataclub/b2-backup.env` en el droplet. El procedimiento
   completo, incluido el de restauración, está en
   [`backup-offsite.md`](backup-offsite.md).

   Con B2 activado, el uploader publica un recibo no secreto y atómico solo
   después de `put` + `HEAD` (tamaño/SHA) + listado remoto. A las 07:00 la
   frescura exige que ese recibo sea reciente y coincida exactamente con el
   dump; si falta, está viejo o discrepa, el `&&` no pingea. Con B2 apagado se
   conserva explícitamente el contrato local.
4. **Pendiente, drill/gate separado de #791.** Probar restore remoto en un
   entorno desechable antes de declarar recuperabilidad. No entra en el cron
   ni copia la identidad privada age al host: se ejecuta fuera del droplet con
   `restore-check.sh <dump>.dump.age --identity <archivo>`.
5. ~~Exigir un segundo destinatario `age`, para que perder una identidad no
   vuelva irrecuperable el histórico entero~~ — **hecho**: `install-cron`
   rechaza instalar el cron con menos de dos destinatarios en
   `backup-recipients.txt` (issue #791). `backup-db.sh` solo avisa, no falla,
   si igual queda corriendo con uno solo — ver
   [`provisioning.md`](provisioning.md).

No instalar un monitor dentro del mismo host como sustituto del control externo:
una caída completa lo silenciaría junto con la aplicación. Por eso los dos
monitores de arriba viven en UptimeRobot y el host solo emite señales.
