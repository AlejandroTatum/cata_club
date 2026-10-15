#!/usr/bin/env bash
# Calcula la próxima versión SemVer (X.Y.Z) de un SHA a partir de los Conventional
# Commits en `<último tag v*>..<sha>`. Imprime SOLO `X.Y.Z` en stdout.
#
#   - un `!` antes de los dos puntos del asunto, o un pie `BREAKING CHANGE:`
#     (o `BREAKING-CHANGE:`) al inicio de una línea del cuerpo -> major;
#   - si no, cualquier `feat` -> minor;
#   - si no -> patch.
#
# El tag base es el `vMAJOR.MINOR.PATCH` más alto ALCANZABLE desde el SHA: un tag en
# otra rama no cuenta. Sin tag base, o sin commits desde él, falla.
set -euo pipefail

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

[ "$#" -eq 1 ] && [ -n "$1" ] || { echo "uso: next-version.sh <sha>" >&2; exit 2; }

sha="$(git rev-parse --verify --quiet "$1^{commit}")" \
  || die "no se encontró el commit '$1' en este repositorio"

# La base es el tag vMAJOR.MINOR.PATCH MÁS ALTO alcanzable desde el SHA, no el más
# cercano (`git describe`): un branch mergeado con un tag viejo quedaría más cerca y
# bajaría la base. `--sort=-v:refname` ordena por versión (1.10.0 > 1.9.0) y el
# filtro estricto deja fuera los prereleases (v1.9.0-rc1) y los tags mal formados.
# Se lee la lista completa, sin `| head` ni `grep -m1`: cortar el pipe con
# `pipefail` activo devolvería SIGPIPE.
# La lista se captura aparte: con `done < <(git ...)` un fallo de git se perdía y
# se diagnosticaba como "falta el tag de arranque".
tag_list="$(git tag --merged "$sha" --list 'v[0-9]*' --sort=-v:refname)" \
  || die "git no pudo listar los tags alcanzables desde ${sha} (ver el error de git arriba)"
tag=""
while IFS= read -r candidate; do
  if [ -z "$tag" ] && [[ "$candidate" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    tag="$candidate"
  fi
done <<< "$tag_list"
if [ -z "$tag" ]; then
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

# Un registro por commit (`-z`: separados por NUL): el asunto decide `!` y `feat` (el
# tipo no distingue mayúsculas, como en Conventional Commits); el cuerpo, el pie
# BREAKING CHANGE (ese token sí es solo en mayúsculas). El pie se busca con el regex de
# bash y no con `printf | grep -q`: con un cuerpo mayor que el buffer del pipe, grep
# sale al primer match, `printf` muere por SIGPIPE y con `pipefail` el 141 se leía como
# "no hay pie": un major salía como patch.
bump=patch
while IFS= read -r -d '' record; do
  subject="${record%%$'\n'*}"
  body=""
  [ "$subject" = "$record" ] || body="${record#*$'\n'}"
  if [[ "$subject" =~ ^[A-Za-z]+(\([^\)]*\))?!: ]] \
     || [[ $'\n'"$body" =~ $'\n'BREAKING[\ -]CHANGE: ]]; then
    bump=major
    break
  fi
  # `tr` y no la expansión de minúsculas de bash >= 4: macOS trae bash 3.2.
  lower_subject="$(printf '%s' "$subject" | tr '[:upper:]' '[:lower:]')"
  if [[ "$lower_subject" =~ ^feat(\([^\)]*\))?: ]]; then
    bump=minor
  fi
done < <(git log -z --format='%s%n%b' "${tag}..${sha}")

case "$bump" in
  major) printf '%s.0.0\n' "$((major + 1))" ;;
  minor) printf '%s.%s.0\n' "$major" "$((minor + 1))" ;;
  patch) printf '%s.%s.%s\n' "$major" "$minor" "$((patch + 1))" ;;
esac
