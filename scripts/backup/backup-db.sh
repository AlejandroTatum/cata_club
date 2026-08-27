#!/usr/bin/env bash
# Backup lógico de PostgreSQL, CIFRADO EN REPOSO y agnóstico del proveedor.
#
# Las credenciales viven dentro del contenedor db; este script nunca las
# exporta ni las imprime. La retención es deliberadamente no destructiva: la
# rotación real se configura con reglas de lifecycle del object store, después
# de tener replicación fuera del host.
#
# POR QUÉ SE CIFRA
# El dump es el padrón completo de los chicos del club: nombre, cédula, fecha
# de nacimiento, tipo de sangre, alergias, condiciones médicas y contacto de
# emergencia. La aplicación protege ese dato en tránsito (autorización
# fail-closed, verificada bajo ataque). Un dump en claro sobre el disco del
# droplet deshace toda esa protección en reposo: un snapshot robado del VPS, un
# rsync mal apuntado o un admin que se va con su llave SSH se lleva el padrón
# entero sin tocar la aplicación.
#
# POR QUÉ `age` CON DESTINATARIO PÚBLICO (y no una passphrase)
# El adversario del modelo de amenaza es exactamente "alguien que puede leer el
# filesystem de este host". Una passphrase simétrica (`gpg --symmetric`, o
# cualquier variante con la clave en el entorno o en un .env) tiene que vivir
# en ESE MISMO host para que el cron pueda correr sin nadie mirando: el
# atacante se lleva el texto cifrado y la llave en el mismo viaje, y el control
# no controla nada. Con cifrado a destinatario, el host solo guarda la clave
# PÚBLICA. Puede escribir backups toda la noche y no puede leer ni uno.
# Entre `age` y `gpg -r`: `age` no tiene keyring, ni agente, ni pinentry, ni
# trustdb, y su identidad privada es UNA línea de texto que entra en un gestor
# de contraseñas. Descifrar es `age -d -i identidad.txt`, y no falla por
# razones ajenas al dato. Eso importa porque el restore se hace en el peor
# momento posible, no en un día tranquilo.
#
# CONFIGURACIÓN (la clave la decide quien opera; este script nunca la inventa)
#   BACKUP_AGE_RECIPIENTS_FILE  archivo con destinatarios age, uno por línea
#                               (default /etc/cataclub/backup-recipients.txt).
#                               Es el camino recomendado: cron NO hereda el
#                               entorno del shell del operador, un archivo sí
#                               está siempre ahí a las 03:30.
#   BACKUP_AGE_RECIPIENTS       alternativa por entorno, separados por espacios.
#   BACKUP_ALLOW_PLAINTEXT=1    escape SOLO para desarrollo local; se ignora
#                               (y aborta) en cualquier invocación productiva.
set -euo pipefail
# Ni el artefacto ni el directorio deben nacer legibles por todo el host.
umask 077

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }
fatal() { log "ERROR: $*" >&2; exit 2; }

STACK_DIR="${BACKUP_STACK_DIR:-$(pwd)}"
COMPOSE_FILES="${BACKUP_COMPOSE_FILES:--f docker-compose.yml -f docker-compose.prod.yml}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/cataclub}"
RETENTION="${BACKUP_RETENTION:-14}"
AGE_BIN="${BACKUP_AGE_BIN:-age}"
DESTINATARIOS_FILE="${BACKUP_AGE_RECIPIENTS_FILE:-/etc/cataclub/backup-recipients.txt}"
PERMITIR_TEXTO_PLANO="${BACKUP_ALLOW_PLAINTEXT:-0}"
case "$RETENTION" in ''|*[!0-9]*) fatal "BACKUP_RETENTION debe ser entero" ;; esac

# Una invocación es productiva si apunta al overlay de producción (lo que hace
# el cron del droplet, que usa el default de arriba) o si el ambiente lo dice.
# Se deriva de las entradas reales del script en vez de pedir una variable
# nueva: una compuerta que hay que acordarse de encender no es una compuerta.
es_produccion() {
  case "$COMPOSE_FILES" in *docker-compose.prod.yml*) return 0 ;; esac
  [ "${AMBIENTE:-}" = "production" ]
}

# --- Destinatarios -----------------------------------------------------------
DESTINATARIOS=()
ORIGEN_DESTINATARIOS=""
if [ -n "${BACKUP_AGE_RECIPIENTS:-}" ]; then
  # Word splitting intencional: es una lista separada por espacios.
  # shellcheck disable=SC2206
  DESTINATARIOS=(${BACKUP_AGE_RECIPIENTS})
  ORIGEN_DESTINATARIOS="BACKUP_AGE_RECIPIENTS"
elif [ -r "$DESTINATARIOS_FILE" ]; then
  while IFS= read -r linea || [ -n "$linea" ]; do
    linea="${linea%%#*}"
    linea="${linea//[[:space:]]/}"
    [ -n "$linea" ] && DESTINATARIOS+=("$linea")
  done < "$DESTINATARIOS_FILE"
  ORIGEN_DESTINATARIOS="$DESTINATARIOS_FILE"
fi

CIFRAR=1
if [ "${#DESTINATARIOS[@]}" -eq 0 ]; then
  if es_produccion; then
    # Fail-closed y ruidoso. Un backup productivo que no puede cifrar tiene que
    # romper el deploy y el cron, no escribir el padrón en claro y salir 0:
    # eso último es justamente el defecto que este control cierra.
    if [ "$PERMITIR_TEXTO_PLANO" = "1" ]; then
      log "ERROR: BACKUP_ALLOW_PLAINTEXT=1 NO habilita texto plano en producción." >&2
      log "       Ese escape existe solo para desarrollo local; acá se ignora." >&2
    fi
    fatal "$(printf '%s\n' \
      "no hay destinatario de cifrado configurado y este backup es productivo." \
      "       El dump contiene datos médicos y cédulas de menores: no se escribe sin cifrar." \
      "       Configurá UNA de las dos y volvé a correr:" \
      "         1) ${DESTINATARIOS_FILE}  <- recomendado (el cron no hereda tu shell)" \
      "         2) BACKUP_AGE_RECIPIENTS='age1...'" \
      "       La clave PRIVADA (identidad age) NO va en este host ni en el repo.")"
  fi
  if [ "$PERMITIR_TEXTO_PLANO" != "1" ]; then
    # Fuera de producción el default sigue siendo cerrado, pero hay salida y el
    # mensaje la nombra: negarle el backup a quien desarrolla, en silencio y
    # sin decirle cómo seguir, es su propia forma de falla.
    fatal "$(printf '%s\n' \
      "no hay destinatario de cifrado configurado." \
      "       Para un backup local sin cifrar (datos de prueba, NUNCA producción):" \
      "         BACKUP_ALLOW_PLAINTEXT=1 $0" \
      "       Para cifrarlo de verdad: BACKUP_AGE_RECIPIENTS='age1...'")"
  fi
  CIFRAR=0
fi

STAMP="$(date +%F)"
if [ "$CIFRAR" = "1" ]; then
  DUMP_FINAL="${BACKUP_DIR}/cataclub_${STAMP}.dump.age"
else
  DUMP_FINAL="${BACKUP_DIR}/cataclub_${STAMP}.dump"
fi
DUMP_TMP="${DUMP_FINAL}.tmp"

ARGS_AGE=()
if [ "$CIFRAR" = "1" ]; then
  command -v "$AGE_BIN" >/dev/null 2>&1 \
    || fatal "$(printf '%s\n' \
      "no se encontró 'age' (${AGE_BIN}); no se degrada a texto plano." \
      "       Instalalo: apt-get install -y age  (o el binario estático de" \
      "       https://github.com/FiloSottile/age/releases)")"
  for destinatario in "${DESTINATARIOS[@]}"; do
    ARGS_AGE+=(-r "$destinatario")
  done
  # Sonda barata ANTES del pg_dump: un destinatario con un typo tiene que
  # fallar ahora y no después de volcar la base entera a las 03:30.
  sonda_err="$(mktemp)"
  trap 'rm -f "$sonda_err"' EXIT
  printf '' | "$AGE_BIN" "${ARGS_AGE[@]}" >/dev/null 2>"$sonda_err" \
    || fatal "age rechazó los destinatarios de ${ORIGEN_DESTINATARIOS}: $(<"$sonda_err")"
  rm -f "$sonda_err"
  trap - EXIT
fi

mkdir -p "$BACKUP_DIR"
trap 'rm -f "$DUMP_TMP"' EXIT
cd "$STACK_DIR"

if [ "$CIFRAR" = "1" ]; then
  log "Dump lógico cifrado hacia ${DUMP_FINAL} (destinatarios: ${#DESTINATARIOS[@]}, origen: ${ORIGEN_DESTINATARIOS})"
  # Word splitting intencional: BACKUP_COMPOSE_FILES es una lista de flags -f.
  # El dump nunca toca el disco sin cifrar: sale del contenedor y entra a `age`
  # por el pipe. Con `pipefail`, que falle pg_dump O age aborta todo y el trap
  # borra el parcial.
  # shellcheck disable=SC2086
  docker compose ${COMPOSE_FILES} exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-privileges' \
    | "$AGE_BIN" "${ARGS_AGE[@]}" > "$DUMP_TMP"
else
  log "AVISO: backup local SIN CIFRAR (BACKUP_ALLOW_PLAINTEXT=1) hacia ${DUMP_FINAL}"
  log "AVISO: este artefacto no sirve para producción ni para datos reales"
  # shellcheck disable=SC2086
  docker compose ${COMPOSE_FILES} exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-privileges' \
    > "$DUMP_TMP"
fi
mv -f "$DUMP_TMP" "$DUMP_FINAL"
trap - EXIT
log "Dump OK: $(du -h "$DUMP_FINAL" | cut -f1)"

count="$(find "$BACKUP_DIR" -maxdepth 1 -type f \
  \( -name 'cataclub_*.dump' -o -name 'cataclub_*.dump.age' \) | wc -l)"
if [ "$count" -gt "$RETENTION" ]; then
  log "AVISO: hay ${count} dumps (retención objetivo: ${RETENTION}); no se borra ninguno automáticamente"
fi

# Un dump en claro que quedó de antes del cifrado sigue siendo el padrón
# completo tirado en el disco. Avisar en cada corrida hasta que no quede
# ninguno: el control nuevo no protege lo que ya estaba escrito.
en_claro="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'cataclub_*.dump' | wc -l)"
if [ "$CIFRAR" = "1" ] && [ "$en_claro" -gt 0 ]; then
  log "AVISO: quedan ${en_claro} dump(s) SIN CIFRAR en ${BACKUP_DIR}."
  log "AVISO: cifralos o borralos de forma segura (ver docs/operations/provisioning.md)."
fi
log "Backup completo"
