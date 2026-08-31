#!/usr/bin/env bash
# Replica del backup CIFRADO hacia un object store S3-compatible (hoy Backblaze
# B2), y verificacion del objeto remoto.
#
# POR QUE EXISTE
# `backup-db.sh` escribe el dump cifrado en `/var/backups/cataclub`, que esta en
# el MISMO disco que la aplicacion. La perdida total del droplet se lleva el
# padron completo del club — nombre, cedula, tipo de sangre, alergias,
# condiciones medicas y contacto de emergencia de menores — sin que ningun
# control local pueda hacer nada. Es el follow-up 3 de
# `docs/operations/monitoring.md`.
#
# POR QUE SE PUEDE REPLICAR SIN EXPONER NADA
# Lo que sale del host es EXACTAMENTE el `.dump.age` que ya estaba en disco. El
# host solo tiene el destinatario `age` (clave publica), asi que ni el que
# escribe el backup ni el que lo replica pueden leerlo. La identidad `age`
# privada no vive aca y no participa de este camino: B2 recibe texto cifrado y
# nada mas. Un bucket comprometido no es una fuga del padron.
#
# POR QUE SE VERIFICA EL OBJETO REMOTO
# Un `put-object` que sale 0 dice que la llamada no fallo, no que del otro lado
# quedo un objeto integro y direccionable. Este script compara tres evidencias
# independientes contra el artefacto local:
#   1. tamano: `ContentLength` del HEAD contra los bytes locales;
#   2. contenido: metadato `sha256` (que sube este mismo script) contra el
#      sha256 local;
#   3. direccionabilidad: la clave aparece en el listado del prefijo, que es
#      como se va a encontrar el backup el dia del desastre.
# El ETag NO se usa como checksum: para una subida multiparte no es el MD5 del
# contenido, ni en S3 ni en B2. Un control que se apoyara en el estaria
# comparando algo que no es el hash del dato.
#
# RETENCION E INMUTABILIDAD SON CONFIGURACION DEL BUCKET
# Object Lock (retencion por defecto de 30 dias) y las reglas de lifecycle
# (~90 dias en total) se administran EN B2, no aca. Un script que pudiera
# borrar objetos remotos anularia justamente la propiedad por la que la copia
# esta fuera del host. Este script solo escribe. La retencion LOCAL tampoco
# cambia: replicar no borra ningun archivo del disco.
#
# CONFIGURACION
# TODA la configuracion se resuelve `entorno -> archivo -> default`, y el
# archivo es el camino REAL: el cron corre con un entorno minimo y NO hereda el
# shell del operador. Una replica activada solo con un `export` en la terminal
# nunca se activaria a las 03:30, que es la unica corrida que importa. Es el
# mismo reparto que `BACKUP_AGE_RECIPIENTS_FILE`.
#
#   BACKUP_B2_CONFIG_FILE           archivo `CLAVE=valor` con lo de abajo
#                                   (default /etc/cataclub/b2-backup.env).
#   BACKUP_B2_ENABLED=1             activa la replica (default 0: no-op).
#   BACKUP_B2_ENDPOINT              endpoint S3 del proveedor.
#   BACKUP_B2_REGION                region del bucket.
#   BACKUP_B2_BUCKET                bucket de destino.
#   BACKUP_B2_PREFIX                prefijo (carpeta logica) dentro del bucket.
#   BACKUP_B2_KEY_ID                application key ID.
#   BACKUP_B2_APPLICATION_KEY       application key.
#   BACKUP_B2_AWS_BIN               cliente S3 (default `aws`).
#   BACKUP_B2_PRODUCTION_BUCKET     bucket que solo produccion puede escribir.
#
# Uso: upload-b2.sh <artefacto.dump.age>
#      upload-b2.sh --check-config    valida la configuracion sin tocar la red
set -euo pipefail
umask 077

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }
fatal() { log "ERROR: $*" >&2; exit 2; }
fatal_operativo() { log "ERROR: $*" >&2; exit 1; }

MODO="subir"
ARTEFACTO=""
case "${1:-}" in
  --check-config) MODO="verificar-config" ;;
  --check-receipt)
    MODO="verificar-recibo"
    ARTEFACTO="${2:-}"
    [ "$#" -eq 2 ] || fatal "uso: upload-b2.sh --check-receipt <artefacto.dump.age>"
    ;;
  "") fatal "uso: upload-b2.sh <artefacto.dump.age> | --check-config | --check-receipt <artefacto.dump.age>" ;;
  -*) fatal "argumento desconocido: $1" ;;
  *) ARTEFACTO="$1" ;;
esac

# --- Configuracion -----------------------------------------------------------
CONFIG_FILE="${BACKUP_B2_CONFIG_FILE:-/etc/cataclub/b2-backup.env}"

# Se PARSEA `CLAVE=valor`; no se hace `source`. Un `source` convertiria un
# archivo de configuracion en ejecucion de codigo con el usuario del cron, y
# este es justamente el archivo que mas manos toca durante el aprovisionamiento.
leer_config() {
  local clave="$1" linea valor
  [ -r "$CONFIG_FILE" ] || return 0
  while IFS= read -r linea || [ -n "$linea" ]; do
    linea="${linea%$'\r'}"
    case "$linea" in
      "${clave}="*)
        valor="${linea#*=}"
        valor="${valor%\"}"; valor="${valor#\"}"
        valor="${valor%\'}"; valor="${valor#\'}"
        printf '%s' "$valor"
        return 0
        ;;
    esac
  done < "$CONFIG_FILE"
  return 0
}

# El entorno gana sobre el archivo (sirve para una corrida manual); el archivo
# es lo que encuentra el cron.
resolver() {
  local clave="$1" desde_entorno="$2"
  if [ -n "$desde_entorno" ]; then printf '%s' "$desde_entorno"; return 0; fi
  leer_config "$clave"
}

HABILITADO="$(resolver BACKUP_B2_ENABLED "${BACKUP_B2_ENABLED:-}")"
ENDPOINT="$(resolver BACKUP_B2_ENDPOINT "${BACKUP_B2_ENDPOINT:-}")"
REGION="$(resolver BACKUP_B2_REGION "${BACKUP_B2_REGION:-}")"
BUCKET="$(resolver BACKUP_B2_BUCKET "${BACKUP_B2_BUCKET:-}")"
PREFIJO="$(resolver BACKUP_B2_PREFIX "${BACKUP_B2_PREFIX:-}")"
B2_KEY_ID="$(resolver BACKUP_B2_KEY_ID "${BACKUP_B2_KEY_ID:-}")"
B2_APP_KEY="$(resolver BACKUP_B2_APPLICATION_KEY "${BACKUP_B2_APPLICATION_KEY:-}")"
AWS_BIN="${BACKUP_B2_AWS_BIN:-aws}"
BUCKET_PRODUCCION="${BACKUP_B2_PRODUCTION_BUCKET:-cataclub-prod-backups-loja-ec}"

if [ "${HABILITADO:-0}" != "1" ]; then
  log "Replica fuera del host desactivada (BACKUP_B2_ENABLED != 1); no se sube nada"
  exit 0
fi

faltantes=()
[ -n "$ENDPOINT" ]   || faltantes+=("BACKUP_B2_ENDPOINT")
[ -n "$REGION" ]     || faltantes+=("BACKUP_B2_REGION")
[ -n "$BUCKET" ]     || faltantes+=("BACKUP_B2_BUCKET")
[ -n "$PREFIJO" ]    || faltantes+=("BACKUP_B2_PREFIX")
[ -n "$B2_KEY_ID" ]  || faltantes+=("BACKUP_B2_KEY_ID")
[ -n "$B2_APP_KEY" ] || faltantes+=("BACKUP_B2_APPLICATION_KEY")

if [ "${#faltantes[@]}" -gt 0 ]; then
  # Fail-closed y con nombre propio: quien lee este mensaje esta en un droplet
  # a las 03:30 y no tiene este archivo abierto al lado.
  fatal "$(printf '%s\n' \
    "la replica esta activada (BACKUP_B2_ENABLED=1) y falta configuracion:" \
    "$(printf '         - %s\n' "${faltantes[@]}")" \
    "       Va todo en ${CONFIG_FILE} (el cron no hereda tu shell)." \
    "       Ver docs/operations/backup-offsite.md")"
fi

command -v sha256sum >/dev/null 2>&1 || fatal "falta 'sha256sum'; no se puede verificar la replica"

if [ "$MODO" = "verificar-config" ]; then
  command -v "$AWS_BIN" >/dev/null 2>&1 \
    || fatal "$(printf '%s\n' \
      "no se encontro el cliente S3 (${AWS_BIN})." \
      "       Instalalo: apt-get install -y awscli  (o el instalador oficial de AWS CLI v2)")"
  # Verificacion sin red y sin credenciales al aire: solo dice que lo que el
  # cron va a encontrar a las 03:30 esta completo. `install-cron` la usa para
  # no instalar un cron cuya replica falla todas las noches.
  log "Configuracion de replica OK: bucket ${BUCKET}, prefijo ${PREFIJO}, endpoint ${ENDPOINT}"
  exit 0
fi

# --- Solo el artefacto completo y cifrado ------------------------------------
# El filtro va ANTES de cualquier llamada a la red. Un `.dump` es el padron en
# claro y un `.tmp` es un dump a medio escribir: ni uno ni otro pueden salir del
# host, y que la subida fallara despues por otra razon no seria el mismo
# control.
case "$ARTEFACTO" in
  *.dump.age) ;;
  *) fatal "$(printf '%s\n' \
      "solo se replica el artefacto cifrado y completo (.dump.age): ${ARTEFACTO}" \
      "       Un .dump es el padron EN CLARO y un .tmp es un dump a medio" \
      "       escribir; ninguno de los dos sale de este host.")" ;;
esac
[ -f "$ARTEFACTO" ] || fatal "no existe o no es un archivo regular: ${ARTEFACTO}"
[ -r "$ARTEFACTO" ] || fatal "no se puede leer: ${ARTEFACTO}"
[ -s "$ARTEFACTO" ] || fatal "el artefacto esta vacio: ${ARTEFACTO}"

NOMBRE="$(basename "$ARTEFACTO")"
TAMANO_LOCAL="$(wc -c < "$ARTEFACTO" | tr -d ' ')"
SHA_LOCAL="$(sha256sum "$ARTEFACTO" | cut -d' ' -f1)"
RECIBO="${ARTEFACTO}.b2-receipt"

if [ "$MODO" = "verificar-recibo" ]; then
  # El chequeo de frescura reutiliza este parser de configuración: si B2 está
  # apagado, conserva explícitamente el contrato local; si está activo, exige la
  # evidencia publicada por este script después de la verificación remota.
  [ -f "$RECIBO" ] || fatal_operativo "no existe el recibo B2 para ${NOMBRE}"
  esperado="$(printf 'artifact=%s\nsha256=%s\nsize=%s' "$NOMBRE" "$SHA_LOCAL" "$TAMANO_LOCAL")"
  actual="$(cat "$RECIBO")"
  [ "$actual" = "$esperado" ] \
    || fatal_operativo "el recibo B2 no coincide exactamente con ${NOMBRE}"
  log "Recibo B2 verificado para ${NOMBRE}"
  exit 0
fi

command -v "$AWS_BIN" >/dev/null 2>&1 \
  || fatal "$(printf '%s\n' \
    "no se encontro el cliente S3 (${AWS_BIN})." \
    "       Instalalo: apt-get install -y awscli  (o el instalador oficial de AWS CLI v2)")"

# --- Un entorno que no es produccion no escribe en el bucket de produccion ---
# El error caro es silencioso en la direccion peligrosa: un staging apuntado al
# bucket productivo ensucia el historico del que depende la recuperacion real, y
# con Object Lock activo esos objetos no se pueden borrar hasta que venza la
# retencion. Es el mismo razonamiento que la URL del heartbeat, que tampoco se
# copia entre entornos (ver docs/operations/provisioning.md).
#
# La condicion se deriva de las mismas entradas que usa `backup-db.sh` para
# decidir si un backup es productivo: una compuerta que hay que acordarse de
# encender no es una compuerta.
COMPOSE_FILES="${BACKUP_COMPOSE_FILES:--f docker-compose.yml -f docker-compose.prod.yml}"
es_produccion() {
  case "$COMPOSE_FILES" in *docker-compose.prod.yml*) return 0 ;; esac
  [ "${AMBIENTE:-}" = "production" ]
}
if [ "$BUCKET" = "$BUCKET_PRODUCCION" ] && ! es_produccion; then
  fatal "$(printf '%s\n' \
    "esta invocacion NO es productiva y apunta al bucket de produccion (${BUCKET})." \
    "       Cada entorno necesita su propio bucket y su propia application key." \
    "       Ambiente: '${AMBIENTE:-<sin definir>}'; compose: ${COMPOSE_FILES}")"
fi

# --- Redaccion ---------------------------------------------------------------
# El error de un cliente S3 puede repetir la credencial que se le paso, y esa
# salida termina en el log del cron, que no esta cifrado y lo lee cualquiera que
# pueda leer /var/log. Nada que venga del cliente se imprime sin pasar por aca.
redactar() {
  local texto="$1"
  if [ -n "$B2_KEY_ID" ]; then texto="${texto//"$B2_KEY_ID"/***}"; fi
  if [ -n "$B2_APP_KEY" ]; then texto="${texto//"$B2_APP_KEY"/***}"; fi
  printf '%s' "$texto"
}

# La credencial viaja por el ENTORNO del proceso hijo, nunca por `argv`: `ps`
# lista la linea de comandos de cualquier proceso para cualquier usuario del
# host, mientras que /proc/<pid>/environ solo lo lee el mismo usuario o root —
# el mismo limite de confianza que el archivo del que salio la credencial.
#
# Los dos ajustes de checksum dejan la peticion como S3 plano: la AWS CLI v2
# reciente agrega encabezados de checksum propios que una implementacion
# no-AWS puede rechazar. La integridad la verifica este script con su propio
# metadato sha256, que no depende del proveedor.
aws_b2() {
  (
    export AWS_ACCESS_KEY_ID="$B2_KEY_ID"
    export AWS_SECRET_ACCESS_KEY="$B2_APP_KEY"
    export AWS_EC2_METADATA_DISABLED=true
    export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
    export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
    "$AWS_BIN" "$@"
  )
}

# --- Subida ------------------------------------------------------------------
PREFIJO_LIMPIO="${PREFIJO#/}"
CLAVE="${PREFIJO_LIMPIO%/}/${NOMBRE}"

log "Replicando ${NOMBRE} (${TAMANO_LOCAL} bytes) hacia s3://${BUCKET}/${CLAVE}"

if ! salida="$(aws_b2 s3api put-object \
    --endpoint-url "$ENDPOINT" \
    --region "$REGION" \
    --bucket "$BUCKET" \
    --key "$CLAVE" \
    --body "$ARTEFACTO" \
    --content-type application/octet-stream \
    --metadata "sha256=${SHA_LOCAL}" 2>&1)"; then
  printf '%s\n' "$(redactar "$salida")" >&2
  fatal_operativo "fallo la subida de ${NOMBRE} a s3://${BUCKET}/${CLAVE}"
fi

# --- Verificacion del objeto remoto -----------------------------------------
if ! cabecera="$(aws_b2 s3api head-object \
    --endpoint-url "$ENDPOINT" \
    --region "$REGION" \
    --bucket "$BUCKET" \
    --key "$CLAVE" \
    --output text \
    --query '[ContentLength,Metadata.sha256]' 2>&1)"; then
  printf '%s\n' "$(redactar "$cabecera")" >&2
  fatal_operativo "no se pudo verificar el objeto remoto s3://${BUCKET}/${CLAVE}"
fi

read -r TAMANO_REMOTO SHA_REMOTO <<< "$cabecera"

if [ "${TAMANO_REMOTO:-}" != "$TAMANO_LOCAL" ]; then
  fatal_operativo "$(printf '%s\n' \
    "la verificacion remota fallo por TAMANO: local ${TAMANO_LOCAL} bytes," \
    "       remoto '${TAMANO_REMOTO:-<vacio>}'. Un objeto truncado es un backup" \
    "       que no se va a poder restaurar.")"
fi

if [ "${SHA_REMOTO:-}" != "$SHA_LOCAL" ]; then
  fatal_operativo "$(printf '%s\n' \
    "la verificacion remota fallo por sha256: local ${SHA_LOCAL}," \
    "       remoto '${SHA_REMOTO:-<vacio>}'.")"
fi

if ! listado="$(aws_b2 s3api list-objects-v2 \
    --endpoint-url "$ENDPOINT" \
    --region "$REGION" \
    --bucket "$BUCKET" \
    --prefix "$CLAVE" \
    --output text \
    --query 'Contents[].Key' 2>&1)"; then
  printf '%s\n' "$(redactar "$listado")" >&2
  fatal_operativo "no se pudo listar s3://${BUCKET}/${CLAVE} para verificar la replica"
fi

case "$listado" in
  *"$CLAVE"*) ;;
  *) fatal_operativo "$(printf '%s\n' \
      "la verificacion remota fallo: la clave no aparece en el listado del" \
      "       prefijo (s3://${BUCKET}/${CLAVE}). El objeto tiene que ser" \
      "       direccionable ahi: es como se lo encuentra el dia del desastre.")" ;;
esac

# El recibo no contiene endpoint ni credenciales: liga solo el nombre, tamaño y
# hash del artefacto local a las tres evidencias remotas de arriba. Se publica por
# rename en el mismo directorio, y únicamente después de put + HEAD + listado.
# Una falla previa no puede crearlo ni adelantarlo.
RECIBO_TMP="${RECIBO}.tmp.$$"
printf 'artifact=%s\nsha256=%s\nsize=%s\n' "$NOMBRE" "$SHA_LOCAL" "$TAMANO_LOCAL" > "$RECIBO_TMP"
mv -f "$RECIBO_TMP" "$RECIBO"

log "Replica verificada: s3://${BUCKET}/${CLAVE} (${TAMANO_LOCAL} bytes, sha256 ${SHA_LOCAL})"
log "Recibo B2 publicado: ${NOMBRE}"
log "La retencion e inmutabilidad de ese objeto son configuracion del bucket (Object Lock + lifecycle)"
