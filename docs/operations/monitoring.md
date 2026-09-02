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

### 2. Heartbeat del backup (¿el backup sigue vivo?)

Un monitor tipo *heartbeat* (dead-man's-switch) con período de 24 h y tolerancia
suficiente para cubrir la corrida de las 07:00.

El cron de las 07:00 corre `check-backup-freshness.sh` y **solo si sale 0**
encadena `notify-heartbeat.sh`, que pingea la URL del heartbeat. El
encadenamiento es `&&`, nunca `;`: con el dump ausente (exit 1) o vencido
(exit 2) el ping NO sale, y UptimeRobot alerta por la ausencia.

Que la alerta sea la AUSENCIA del ping es lo que hace que esto sirva. Cubre a la
vez el backup vencido, el cron desinstalado, el disco lleno y el host apagado —
ninguno de los cuales puede reportarse a sí mismo. Un chequeo que tuviera que
enviar su propia alerta se callaría en todos esos casos.

La URL lleva el token en el path, así que es un secreto: no va al crontab (que
`crontab -l` lista sin privilegios) ni a ningún log. `notify-heartbeat.sh` la
lee de un archivo de root y no la imprime en ningún camino, ni siquiera al
fallar.

## Señales disponibles en el host

- `scripts/ops/check-backup-freshness.sh --max-age-hours 26` sale `0` si existe
  un dump reciente, `1` si no existe y `2` si supera el RPO.
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
