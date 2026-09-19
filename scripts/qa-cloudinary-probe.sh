#!/usr/bin/env bash
# Probe de `make qa-live` (issue #1352, R4-001; extraído del Makefile en el
# follow-up de #1356, R1/R2 del review nativo) -- le pregunta al backend de
# QA YA LEVANTADO si `CLOUDINARY_API_KEY` llegó no vacío, y distingue "el
# exec falló" de "0/no configurado".
#
# Antes (antes de #1352), cualquier falla del `compose exec` (proyecto mal
# levantado, comando de compose equivocado, el daemon con error, un backend
# reiniciándose) caía en un `|| echo 0` y se leía exactamente como
# "Cloudinary no configurado" -- los specs que suben un voucher se salteaban
# en silencio, con un motivo que afirma justo lo contrario de lo que pasó.
#
# Solo se captura STDOUT del `exec` (nunca `2>&1`): un WARN benigno de
# Compose en stderr no rompe la comparación ni aborta la suite entera. El
# exit status del `exec` se chequea aparte; un exec que de verdad falla
# sigue fallando fuerte, con el código de salida en el mensaje. El `case`
# exige `0`/`1` literal en stdout -- cualquier otra salida es "no se pudo
# determinar", nunca "no configurado".
#
# Uso: qa-cloudinary-probe.sh <comando de compose...>
# El llamador antepone las variables de entorno que compose necesita (p. ej.
# `JWT_SECRET_KEY=...`) como asignación de shell antes de invocar este
# script -- acá solo se agrega el `exec -T backend sh -c '...'` final.
set -u

if [ "$#" -eq 0 ]; then
  echo "qa-cloudinary-probe: falta el comando de compose" >&2
  exit 1
fi

cloudinary=$("$@" exec -T backend sh -c '[ -n "$CLOUDINARY_API_KEY" ] && echo 1 || echo 0')
estado=$?
if [ "$estado" -ne 0 ]; then
  echo "qa-live: no se pudo determinar E2E_CLOUDINARY_CONFIGURED -- el exec al backend falló (código $estado)" >&2
  exit 1
fi

case "$cloudinary" in
  0 | 1) ;;
  *)
    echo "qa-live: no se pudo determinar E2E_CLOUDINARY_CONFIGURED -- salida inesperada del exec: $cloudinary" >&2
    exit 1
    ;;
esac

echo "qa-live: E2E_CLOUDINARY_CONFIGURED=$cloudinary"
