#!/usr/bin/env bash
#
# Verificacion de restore de punta a punta en un ENTORNO DESECHABLE.
#
# NUNCA restaura contra el stack productivo ni su volumen: levanta un Postgres
# efimero (--rm), restaura el dump, valida y lo destruye al terminar (trap).
# Esto es lo que desbloquea la fila "Backup y restore de Postgres" de
# production-readiness.md: mecanismo verificado, no teoria.
#
# Uso: restore-check.sh <dump-file|dump-file.age>
#        [--expect-revision <alembic_revision>] [--identity <archivo-age>]
#
# Acepta tanto un dump en claro (.dump) como el artefacto cifrado que produce
# backup-db.sh (.dump.age). Para el cifrado hace falta la IDENTIDAD age
# privada, que NO vive en el host de backup: se trae al momento de restaurar.
# Se puede pasar con --identity o por BACKUP_AGE_IDENTITY.
#
# El descifrado va a un directorio temporal privado (umask 077, mktemp -d) que
# el trap destruye al salir, pase lo que pase. La copia en claro existe solo
# mientras dura la verificacion y nunca se escribe al lado del backup.
#
# Validaciones (todas imprimen evidencia; fallan con exit != 0):
#   1. El dump se restaura sin errores.
#   2. La tabla alembic_version existe y, si se pasa --expect-revision,
#      coincide con la revision esperada.
#   3. Las tablas criticas existen y sus conteos se imprimen.
#
# Dependencias: docker (cliente) y, para artefactos .age, `age`.

set -euo pipefail
umask 077

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }

DUMP_FILE="${1:?uso: restore-check.sh <dump-file> [--expect-revision <rev>] [--identity <archivo>]}"
shift
EXPECT_REVISION=""
AGE_IDENTITY="${BACKUP_AGE_IDENTITY:-}"
AGE_BIN="${BACKUP_AGE_BIN:-age}"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --expect-revision) EXPECT_REVISION="${2:?falta revision}"; shift 2 ;;
    --identity) AGE_IDENTITY="${2:?falta el archivo de identidad}"; shift 2 ;;
    *) log "Argumento desconocido: $1" >&2; exit 2 ;;
  esac
done

[ -r "${DUMP_FILE}" ] || { log "No se puede leer el dump: ${DUMP_FILE}" >&2; exit 2; }

IMAGE="postgres:16-alpine"   # misma imagen del servicio db del stack
NAME="cataclub-restore-check"
RUSER="restore_check"
RPASS="restore_check_password"
RDB="cataclub_restore"
RPORT="55432"
DUMP_MOUNT="/dump"

TRABAJO=""
cleanup() {
  log "Destruyendo entorno desechable (${NAME})"
  docker rm -f "${NAME}" >/dev/null 2>&1 || true
  # El descifrado transitorio no puede sobrevivir a esta corrida.
  [ -n "${TRABAJO}" ] && rm -rf "${TRABAJO}"
  return 0
}
trap cleanup EXIT

# Descifrado del artefacto .age ANTES de levantar nada: si falta la identidad
# conviene enterarse ahora y no despues de arrancar un Postgres.
case "${DUMP_FILE}" in
  *.age)
    command -v "${AGE_BIN}" >/dev/null 2>&1 || {
      log "Falta 'age' (${AGE_BIN}) para descifrar ${DUMP_FILE}" >&2
      log "Instalalo: apt-get install -y age" >&2
      exit 2
    }
    if ! { [ -n "${AGE_IDENTITY}" ] && [ -r "${AGE_IDENTITY}" ]; }; then
      log "El dump esta cifrado y falta la identidad age para leerlo." >&2
      log "Pasala con --identity <archivo> o BACKUP_AGE_IDENTITY=<archivo>." >&2
      log "Es la clave PRIVADA: no vive en el host de backup, se trae al restaurar." >&2
      exit 2
    fi
    TRABAJO="$(mktemp -d)"
    chmod 700 "${TRABAJO}"
    CLARO="${TRABAJO}/$(basename "${DUMP_FILE%.age}")"
    log "Descifrando ${DUMP_FILE} en un directorio temporal privado"
    "${AGE_BIN}" -d -i "${AGE_IDENTITY}" -o "${CLARO}" "${DUMP_FILE}" || {
      log "No se pudo descifrar el dump (identidad incorrecta o artefacto corrupto)" >&2
      exit 1
    }
    DUMP_FILE="${CLARO}"
    ;;
esac

# Un contenedor colgado de una corrida previa no debe frenar la verificacion.
docker rm -f "${NAME}" >/dev/null 2>&1 || true

log "Levantando Postgres desechable (${IMAGE}) en 127.0.0.1:${RPORT}"
docker run -d --rm --name "${NAME}" \
  -e POSTGRES_USER="${RUSER}" \
  -e POSTGRES_PASSWORD="${RPASS}" \
  -e POSTGRES_DB="${RDB}" \
  -p "127.0.0.1:${RPORT}:5432" \
  "${IMAGE}" >/dev/null

log "Esperando readiness del Postgres desechable"
ready=0
for i in $(seq 1 30); do
  if docker run --rm --network host "${IMAGE}" \
      pg_isready -h 127.0.0.1 -p "${RPORT}" -U "${RUSER}" -q; then
    ready=1
    break
  fi
  [ "${i}" -eq 30 ] && break
  sleep 1
done
[ "${ready}" = "1" ] || { log "Postgres desechable no arranco a tiempo" >&2; exit 1; }

log "Restaurando ${DUMP_FILE}"
docker run --rm --network host \
  -e PGPASSWORD="${RPASS}" \
  -v "$(dirname "$(realpath "${DUMP_FILE}")")":"${DUMP_MOUNT}":ro \
  "${IMAGE}" \
  pg_restore -h 127.0.0.1 -p "${RPORT}" -U "${RUSER}" -d "${RDB}" \
    --no-owner --no-privileges --exit-on-error \
    "${DUMP_MOUNT}/$(basename "${DUMP_FILE}")"

psql_cmd() {
  docker run --rm --network host \
    -e PGPASSWORD="${RPASS}" \
    "${IMAGE}" \
    psql -h 127.0.0.1 -p "${RPORT}" -U "${RUSER}" -d "${RDB}" -tA -c "$1"
}

log "Validacion: alembic_version"
VERSION_NUM="$(psql_cmd 'SELECT version_num FROM alembic_version;')"
[ -n "${VERSION_NUM}" ] || { log "alembic_version vacia o ausente" >&2; exit 1; }
log "  revision en el dump: ${VERSION_NUM}"
if [ -n "${EXPECT_REVISION}" ]; then
  [ "${VERSION_NUM}" = "${EXPECT_REVISION}" ] \
    || { log "Revision inesperada: esperaba ${EXPECT_REVISION}" >&2; exit 1; }
  log "  coincide con la esperada (${EXPECT_REVISION})"
fi

log "Validacion: conteos de tablas criticas"
for t in persona membresia pago asistencia; do
  count="$(psql_cmd "SELECT count(*) FROM ${t};")"
  log "  ${t}: ${count}"
done

log "RESTORE OK (entorno desechable destruido)"