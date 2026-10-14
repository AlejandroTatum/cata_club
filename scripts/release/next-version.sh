#!/usr/bin/env bash
# Calcula la próxima versión SemVer (X.Y.Z) de un SHA a partir de los Conventional
# Commits en `<último tag v*>..<sha>`. Imprime SOLO `X.Y.Z` en stdout.
#
#   - un `!` antes de los dos puntos del asunto, o un pie `BREAKING CHANGE:`
#     (o `BREAKING-CHANGE:`) al inicio de una línea del cuerpo -> major;
#   - si no, cualquier `feat` -> minor;
#   - si no -> patch.
#
# El tag base es el último `vMAJOR.MINOR.PATCH` ALCANZABLE desde el SHA: un tag en
# otra rama no cuenta. Sin tag base, o sin commits desde él, falla.
set -euo pipefail

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

[ "$#" -eq 1 ] && [ -n "$1" ] || { echo "uso: next-version.sh <sha>" >&2; exit 2; }

sha="$(git rev-parse --verify --quiet "$1^{commit}")" \
  || die "no se encontró el commit '$1' en este repositorio"

# `--exclude 'v*-*'` deja fuera los prereleases (v1.9.0-rc1): no son una base de release.
if ! tag="$(git describe --tags --abbrev=0 --match 'v[0-9]*.[0-9]*.[0-9]*' --exclude 'v*-*' "$sha" 2>/dev/null)"; then
  die "$(printf '%s\n' \
    "no hay ningún tag vMAJOR.MINOR.PATCH alcanzable desde ${sha}." \
    "       Falta el tag de arranque: ponelo en el SHA que hoy corre en producción y subilo:" \
    "         git tag -a v1.3.0 <sha-en-producción> -m v1.3.0" \
    "         git push origin refs/tags/v1.3.0")"
fi
[[ "$tag" =~ ^v([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] \
  || die "el tag base '${tag}' no es vMAJOR.MINOR.PATCH"
major="${BASH_REMATCH[1]}"; minor="${BASH_REMATCH[2]}"; patch="${BASH_REMATCH[3]}"

commits="$(git rev-list --count "${tag}..${sha}")"
[ "$commits" -gt 0 ] || die "no hay commits entre ${tag} y ${sha}: no hay nada que publicar"

# Un registro por commit (`-z`: separados por NUL): el asunto decide `!` y `feat`; el
# cuerpo, el pie BREAKING CHANGE.
bump=patch
while IFS= read -r -d '' record; do
  subject="${record%%$'\n'*}"
  body=""
  [ "$subject" = "$record" ] || body="${record#*$'\n'}"
  if [[ "$subject" =~ ^[A-Za-z]+(\([^\)]*\))?!: ]] \
     || printf '%s\n' "$body" | grep -Eq '^BREAKING[ -]CHANGE:'; then
    bump=major
    break
  fi
  if [[ "$subject" =~ ^feat(\([^\)]*\))?: ]]; then
    bump=minor
  fi
done < <(git log -z --format='%s%n%b' "${tag}..${sha}")

case "$bump" in
  major) printf '%s.0.0\n' "$((major + 1))" ;;
  minor) printf '%s.%s.0\n' "$major" "$((minor + 1))" ;;
  patch) printf '%s.%s.%s\n' "$major" "$minor" "$((patch + 1))" ;;
esac
