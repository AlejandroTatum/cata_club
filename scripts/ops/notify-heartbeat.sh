#!/usr/bin/env bash
# Ping the external dead-man's-switch after a successful backup freshness check.
# The heartbeat URL is a credential and is NEVER printed, logged or echoed.
#
# El monitor externo (UptimeRobot; ver docs/operations/monitoring.md) no
# pregunta nada: espera este ping y alerta cuando DEJA de llegar. Por eso el
# script tiene una sola responsabilidad y ninguna tolerancia -- si el ping no
# sale, sale distinto de 0 y el ping no ocurre, que es justo lo que dispara la
# alarma. Reintentar acá enmascararía una caída real durante minutos.
#
# La URL lleva el token en el path: quien la lee puede pingear a mano y dejar la
# alarma en verde para siempre con el backup muerto. Por eso vive en un archivo
# de root (`/etc/cataclub/heartbeat-url.txt`, 640) y NO en el crontab, que
# cualquiera lista con `crontab -l`; y por eso ningún mensaje de este script la
# imprime, ni siquiera al fallar.
set -euo pipefail

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

HEARTBEAT_URL_FILE="${HEARTBEAT_URL_FILE:-/etc/cataclub/heartbeat-url.txt}"

command -v curl >/dev/null 2>&1 || die "falta 'curl' en el host (apt-get install -y curl); el heartbeat no puede pingear"

[ -f "$HEARTBEAT_URL_FILE" ] || die "$(printf '%s\n' \
  "no hay URL de heartbeat en ${HEARTBEAT_URL_FILE}." \
  "       Sin ese archivo el ping no sale, y el monitor externo alerta a las" \
  "       pocas horas como si el backup hubiera muerto. Ver" \
  "       docs/operations/provisioning.md para crearlo.")"

# Primera línea con algo que no sea espacio: un archivo recién creado con
# `touch`, o editado a medias, no es una configuración.
url="$(grep -m1 '[^[:space:]]' "$HEARTBEAT_URL_FILE" || true)"
url="${url#"${url%%[![:space:]]*}"}"
url="${url%"${url##*[![:space:]]}"}"
[ -n "$url" ] || die "$(printf '%s\n' \
  "la URL de heartbeat en ${HEARTBEAT_URL_FILE} está vacía." \
  "       El archivo existe pero no tiene ninguna línea con contenido.")"

# El token viaja en el path de la URL: sobre http lo lee cualquiera en el
# camino, y con él se silencia la alarma. No se imprime el valor leído.
case "$url" in
  https://*) ;;
  *) die "la URL de heartbeat en ${HEARTBEAT_URL_FILE} no empieza con https:// (no se imprime su contenido: es un secreto)" ;;
esac

# `2>/dev/null` sobre curl, a propósito: ante un fallo de DNS el curl real
# escribe `curl: (6) Could not resolve host: <host>` y ahí se filtraría parte de
# la URL a un log que después alguien pega en un chat. El código de salida es
# todo el diagnóstico que se conserva (6 DNS, 22 error HTTP, 28 timeout).
codigo=0
curl -fsS -m 10 -o /dev/null "$url" 2>/dev/null || codigo=$?
[ "$codigo" -eq 0 ] || die "el ping al heartbeat falló (curl salió ${codigo}); no se imprime la URL"

log "Heartbeat pingeado"
