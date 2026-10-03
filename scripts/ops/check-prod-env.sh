#!/usr/bin/env bash
# Fail-closed validation of the production `.env` BEFORE the first prod deploy.
#
# Reads the file as data (never sourced) and reports only variable NAMES,
# never values. Complements preflight-production.sh, which checks image, git,
# migrations, SMTP and backups; this script covers the leftovers of a
# staging-to-production reconversion:
#   - DOMINIO_INDEXABLE == DOMINIO (otherwise Caddy ships `noindex` to prod);
#   - DOMINIO_ALIAS_WWW == www.$DOMINIO (www 301-redirects to the apex);
#   - no `staging.` in DOMINIO / CORS_ORIGENES / FRONTEND_URL, which must
#     reference https://$DOMINIO;
#   - no `staging` in the Cloudinary folder names;
#   - JWT_SECRET_KEY / POSTGRES_PASSWORD real (same rules as the backend's
#     fail-fast in backend/app/soporte_transversal/configuracion.py);
#   - optional --previous-env: secrets differ from the old env (compared by
#     hash only), proving they were rotated.
set -euo pipefail

usage() { echo "uso: check-prod-env.sh [--env-file <ruta>] [--previous-env <ruta>]" >&2; }

ENV_FILE=".env"
PREVIOUS_ENV=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --env-file) ENV_FILE="${2:-}"; shift 2 ;;
    --previous-env) PREVIOUS_ENV="${2:-}"; shift 2 ;;
    *) usage; exit 2 ;;
  esac
done

[ -r "$ENV_FILE" ] || { echo "ERROR: no se puede leer el archivo de entorno: $ENV_FILE" >&2; exit 1; }
if [ -n "$PREVIOUS_ENV" ] && [ ! -r "$PREVIOUS_ENV" ]; then
  echo "ERROR: no se puede leer --previous-env: $PREVIOUS_ENV" >&2
  exit 1
fi

problems=()
fail() { problems+=("$*"); }

# Last assignment wins (as in Compose); one pair of surrounding quotes is
# stripped. Never evaluated by the shell.
env_value() {
  local file="$1" key="$2" value
  value="$(sed -n "s/^${key}=//p" "$file" | tail -1 | tr -d '\r')"
  case "$value" in
    \"*\") value="${value#\"}"; value="${value%\"}" ;;
    \'*\') value="${value#\'}"; value="${value%\'}" ;;
  esac
  printf '%s' "$value"
}
val() { env_value "$ENV_FILE" "$1"; }

is_placeholder() { case "$1" in '<'*'>'*) return 0 ;; *) return 1 ;; esac; }

# Same markers as _PLACEHOLDERS_SECRETO in the backend config.
has_secret_marker() {
  local v="$1" m
  for m in CAMBIAR genera-una-clave dev-only do-not-use-in-production; do
    case "$v" in *"$m"*) return 0 ;; esac
  done
  return 1
}

lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

DOMINIO="$(val DOMINIO)"
if [ -z "$DOMINIO" ] || is_placeholder "$DOMINIO"; then
  fail "DOMINIO vacío o sin reemplazar"
else
  case "$DOMINIO" in *://*|*/*) fail "DOMINIO debe ser solo el host, sin esquema ni ruta" ;; esac
  case "$(lower "$DOMINIO")" in staging.*) fail "DOMINIO apunta a staging" ;; esac
fi

INDEXABLE="$(val DOMINIO_INDEXABLE)"
if [ -z "$INDEXABLE" ]; then
  fail "DOMINIO_INDEXABLE falta o está vacío: producción saldría con noindex"
elif [ "$INDEXABLE" != "$DOMINIO" ]; then
  fail "DOMINIO_INDEXABLE debe ser idéntico a DOMINIO"
fi

ALIAS_WWW="$(val DOMINIO_ALIAS_WWW)"
if [ -z "$ALIAS_WWW" ] || is_placeholder "$ALIAS_WWW"; then
  fail "DOMINIO_ALIAS_WWW falta o sin reemplazar: www no redirigiría al dominio canónico"
elif [ -n "$DOMINIO" ] && [ "$ALIAS_WWW" != "www.${DOMINIO}" ]; then
  fail "DOMINIO_ALIAS_WWW debe ser www.\$DOMINIO"
fi

if [ -n "$DOMINIO" ] && ! is_placeholder "$DOMINIO"; then
  CORS="$(val CORS_ORIGENES)"
  if [ -z "$CORS" ]; then
    fail "CORS_ORIGENES vacío"
  else
    case "$(lower "$CORS")" in *staging.*) fail "CORS_ORIGENES contiene staging." ;; esac
    case ",${CORS// /}," in
      *",https://${DOMINIO},"*) ;;
      *) fail "CORS_ORIGENES debe incluir https://\$DOMINIO" ;;
    esac
  fi

  FRONTEND="$(val FRONTEND_URL)"
  if [ -z "$FRONTEND" ]; then
    fail "FRONTEND_URL vacío"
  else
    case "$(lower "$FRONTEND")" in *staging.*) fail "FRONTEND_URL contiene staging." ;; esac
    case "${FRONTEND%/}" in
      "https://${DOMINIO}") ;;
      *) fail "FRONTEND_URL debe ser https://\$DOMINIO" ;;
    esac
  fi
fi

for name in CLOUDINARY_CARPETA_COMPROBANTES CLOUDINARY_CARPETA_VOUCHERS CLOUDINARY_CARPETA_FOTOS_PERFIL; do
  case "$(lower "$(val "$name")")" in *staging*) fail "$name contiene staging" ;; esac
done

JWT="$(val JWT_SECRET_KEY)"
if [ -z "$JWT" ] || is_placeholder "$JWT" || has_secret_marker "$JWT" || [ "${#JWT}" -lt 16 ]; then
  fail "JWT_SECRET_KEY vacío, placeholder o más corto que 16 caracteres"
fi

PG="$(val POSTGRES_PASSWORD)"
if [ -z "$PG" ] || is_placeholder "$PG" || has_secret_marker "$PG" || [ "$PG" = "password" ] || [ "${#PG}" -lt 8 ]; then
  fail "POSTGRES_PASSWORD vacío, placeholder, de ejemplo o más corto que 8 caracteres"
fi

if [ -n "$PREVIOUS_ENV" ]; then
  command -v sha256sum >/dev/null 2>&1 || { echo "ERROR: falta sha256sum para --previous-env" >&2; exit 1; }
  for name in JWT_SECRET_KEY POSTGRES_PASSWORD; do
    new="$(env_value "$ENV_FILE" "$name")"
    old="$(env_value "$PREVIOUS_ENV" "$name")"
    if [ -n "$new" ] && [ -n "$old" ] \
      && [ "$(printf '%s' "$new" | sha256sum)" = "$(printf '%s' "$old" | sha256sum)" ]; then
      fail "$name no fue rotado: coincide con el entorno previo"
    fi
  done
fi

if [ "${#problems[@]}" -gt 0 ]; then
  for p in "${problems[@]}"; do echo "ERROR: $p" >&2; done
  exit 1
fi
echo "check-prod-env OK: $ENV_FILE"
