#!/usr/bin/env bash
# Etiqueta un release YA desplegado. Corre en la máquina del dueño del repo, nunca
# en el host de producción (que no tiene credenciales de escritura en GitHub).
#
#   tag-release.sh <sha> <health_url>
#
# 1. Recalcula la versión con next-version.sh.
# 2. Verifica que <health_url> sirva EXACTAMENTE ese sha (completo) y esa versión.
# 3. Crea el tag anotado vX.Y.Z en el SHA y sube SOLO ese tag.
# Ante cualquier discrepancia se niega sin crear nada.
set -euo pipefail

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

[ "$#" -eq 2 ] && [ -n "$1" ] && [ -n "$2" ] || { echo "uso: tag-release.sh <sha> <health_url>" >&2; exit 2; }
HEALTH_URL="$2"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
command -v curl >/dev/null 2>&1 || die "falta curl"
command -v python3 >/dev/null 2>&1 || die "falta python3 para leer la respuesta de health"

sha="$(git rev-parse --verify --quiet "$1^{commit}")" \
  || die "no se encontró el commit '$1' en este repositorio"
version="$("$SCRIPT_DIR/next-version.sh" "$sha")" \
  || die "no se pudo calcular la versión de ${sha}"
tag="v${version}"

body="$(curl -fsS --max-time 10 "$HEALTH_URL")" \
  || die "no se pudo leer ${HEALTH_URL}; no se crea ningún tag"

# Imprime una línea por discrepancia; sale 1 si hay alguna.
if ! mismatches="$(printf '%s' "$body" | python3 -c '
import json, sys

expected_sha, expected_version = sys.argv[1], sys.argv[2]
try:
    data = json.load(sys.stdin)
except json.JSONDecodeError:
    print("la respuesta de health no es JSON")
    raise SystemExit(1)
if not isinstance(data, dict):
    data = {}
problems = []
if data.get("sha") != expected_sha:
    problems.append("el campo sha de health (%r) no es el SHA completo %s" % (data.get("sha"), expected_sha))
if data.get("version") != expected_version:
    problems.append("el campo version de health (%r) no es la versión calculada %s" % (data.get("version"), expected_version))
print("\n".join(problems))
raise SystemExit(1 if problems else 0)
' "$sha" "$version")"; then
  die "$(printf '%s\n' \
    "producción no sirve lo que se quiere etiquetar; no se crea ${tag}." \
    "       ${mismatches}" \
    "       Desplegá primero (SHA e APP_VERSION en el .env del host) y repetí.")"
fi

if git rev-parse --verify --quiet "refs/tags/${tag}" >/dev/null; then
  die "el tag ${tag} ya existe localmente; no se crea nada"
fi
remote_tag="$(git ls-remote --tags origin "refs/tags/${tag}")" \
  || die "no se pudo consultar los tags de origin; no se crea ningún tag"
[ -z "$remote_tag" ] || die "el tag ${tag} ya existe en origin; traé los tags (git fetch --tags) y recalculá"

git tag -a "$tag" -m "Release ${tag}" "$sha"
if ! git push origin "refs/tags/${tag}"; then
  git tag -d "$tag" >/dev/null
  die "no se pudo subir ${tag} a origin; se quitó el tag local, repetí cuando origin responda"
fi
log "Release etiquetado: ${tag} -> ${sha}"
