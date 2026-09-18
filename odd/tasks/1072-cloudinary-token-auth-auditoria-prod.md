# Feature: #1072 — Cloudinary token auth en producción + auditoría de comprobantes legacy

Issue: AlejandroTatum/cata_club#1072 (OPEN, type:chore)
Base: `main` @ e26891e. Modo: ops guiada (usuario autorizó ejecución sobre producción).
Estado repo-side: completo — wiring de `cloudinary_auth_token_key` (settings + SDK + `auth_token.duration`, vigencia 900 s) y `backend/scripts/auditar_comprobantes_legacy.py` ya en `main` (PR #1097 / 3631e70).

## Criterios de aceptación del issue
1. Token-based auth activado en la cuenta Cloudinary de producción y verificado: una URL firmada deja de servir tras su vencimiento.
2. Auditoría sobre `voucher_url`/`archivo_url` con esquema `http(s)://` en prod; filas encontradas se re-suben como `authenticated` o se aceptan como riesgo residual documentado.
3. Resultado registrado en `cata_club-docs/archive/fixes/16-voucher-no-enumerable.md` o su sucesor.

## Decisión tomada (2026-09-15, dueño)
Token auth de Cloudinary descartado (requiere Advanced $249/mes, cuenta en Free). Se extiende el patrón download-endpoint (`private_download_url` + `expires_at` verificado server-side, ya probado con PDFs) a las imágenes (vouchers JPEG/PNG, foto de perfil). Criterio 1 se satisface por esta vía.
- Host prod: repo en `/opt/cata-club` (convención de `backup-restore.md`), `.env` en el host, deploy por `scripts/deploy/deploy.sh`. SSH target pendiente de confirmación por el dueño.
- Riesgo a vigilar al habilitar token auth: modo NO estricto (assets públicos `type=upload` deben seguir sirviendo sin token; p. ej. landing).
- Vigencia de URL firmada: `CLOUDINARY_URL_FIRMADA_VIGENCIA_SEGUNDOS = 900` (resiliencia.py:64).
- Reglas: nunca imprimir secretos en la sesión; cada mutación de prod se muestra antes de ejecutar; sin cambios de config productiva fuera de este flujo autorizado.

## Tasks
- [x] 1. Recon prod: SSH `deploy@staging.cataclub.com`, host `staging-cataclub`, repo `/opt/cata-club` @ 3f7cbb3c, stack 7 servicios healthy. Cloud name `islw1tsg`; `CLOUDINARY_AUTH_TOKEN_KEY` ausente en `.env`.
- [x] 2. Auditoría ejecutada (read-only Postgres) contra la DB del host: `Pago.voucher_url` total=14 **legacy=0** (3 migrada, 11 vacia); `ComprobantePago.archivo_url` total=13 **legacy=0** (13 migrada). Criterio 2 satisfecho: no hay URLs públicas que migrar ni riesgo residual que aceptar.
- [x] 3. Decisión del dueño según resultado: ~~re-subir filas~~ no aplica — cero filas legacy; el dueño aceptó la entrega en un solo PR el 2026-09-18 sin filas que re-subir.
- [x] 4. (2026-09-15, ver evidence log: 200 → 401 `Stale request`, asset de prueba destruido) Pre-verificar en vivo el mecanismo: imagen real por `private_download_url` con `expires_at` corto → 200 y luego 401 tras vencer (cuenta Free, sin código nuevo).
- [x] 5. Implementar: 9 commits en `chore/1072-vencimiento-urls-imagenes`, rebaseados sobre `7b41f3e`; `make pre-pr LANE=full` verde (2774 backend, 625 root, 5108 vitest, 218 e2e). Review nativo lineage `review-d103f2650ca46910`: 1 CRITICAL (R3-001, foto de perfil anterior huérfana al cambiar de extensión o reemplazar fila legacy) corregido en `8834233` (184/200 líneas, RED 3 → GREEN 4), validador `approved`, acknowledge quemado. Backend lane final 2778 + 625 verde. PR #1307 mergeado por squash como `a35d90c` (2026-09-18); issue #1072 cerrado.
- [ ] 6. **Pendiente del dueño (operación remota sobre el host).** Deploy a staging + verificación de vencimiento real end-to-end + smoke del sitio.
- [x] 7. (cata_club-docs PR #14 mergeado como `7ddfe20`, 2026-09-18: readiness A-7 resuelto + cierre en Fix 16) Registrar resultado en `cata_club-docs` (16-voucher-no-enumerable.md o sucesor) con evidencia y fecha.
- [x] 8. Issue #1072 cerrado por `Closes` en PR #1307 (2026-09-18); el cuerpo del PR lleva la evidencia y los follow-ups.

## Evidence log
- 2026-09-15: recon SSH OK; stack healthy; audit script presente en deploy (>= 3631e70).
- 2026-09-15: auditoría read-only ejecutada en el host (`docker compose exec -T backend /app/.venv/bin/python -m scripts.auditar_comprobantes_legacy`): voucher_url 14/0/3/11, archivo_url 13/0/13/0 — cero legacy.
- 2026-09-15: verificado que el frontend no construye URLs de Cloudinary (solo CSP img-src) — habilitar token auth no rompe el borde.
- 2026-09-15: **Cloudinary cambió el mecanismo**: ya NO hay toggle self-service de token-based auth (Console > Settings > Security no muestra nada — reportado por el dueño y confirmado contra doc oficial `control_access_to_media`). Se provisiona vía soporte, requiere plan **Advanced+ ($249/mes o $224 anual)**, y la clave la genera/envía Cloudinary (hex, no es el API secret). Cuenta `islw1tsg` está en plan **Free** (usage: 204 objetos, 105 transformaciones, 0.11 créditos).
- 2026-09-15: **Sonda en vivo (cuenta real, plan Free)**: `image/download` sirve `type=upload` (200 sponsor jpg) pero 404 para `type=authenticated` — el endpoint NO resuelve imágenes autenticadas, solo raw. **Solución validada**: upload `raw/authenticated` de jpg → `raw/download` con `expires_at` → `200 image/jpeg` → tras vencer `401 Stale request`; destroy OK (asset de prueba eliminado, cuenta limpia). Content-type correcto para `<img src>`. Además: existen assets públicos `cataclub/sponsors/*` (type=upload) — relevante si algún día se habilita token auth estricto.
- 2026-09-15: diseño final: subir vouchers/fotos como raw/authenticated (public_id con extensión), entrega por `_url_descarga_api` existente, migrar ~15 assets image/authenticated a raw (re-upload + destroy viejos + update filas), CSP img-src + api.cloudinary.com. Fotos perfil hoy sin transformaciones (jpgs 2-4 MB originales) → pueden ir a raw.
- 2026-09-17: candidate completo en 8 commits, `make pre-pr LANE=full` verde; verifier independiente detectó y se corrigió borrado/supresión pre-migración y MIME nulo/atípico. Review nativo autorizado por el dueño, lineage `review-62381b393bcc2be4`, quedó bloqueado por 429 de cuota (reset 2026-09-18 20:37:51); `prepared_reviewers=0`, `submitted_reviewers=0`, sin mutación. Fresh STATUS reofrece 4 slots; no reintentar hasta reset.: `_url_descarga_api` (`cloudinary.utils.private_download_url`, resource_type="raw", `expires_at` **chequeado server-side por Cloudinary → 401 Stale request**) hace vencer los PDFs SIN token auth y SIN plan Advanced — funciona en Free. `private_download_url` soporta `resource_type="image"` (es su default en el SDK). Ruta posible: derivar vouchers/fotos JPEG-PNG por el mismo endpoint → vencimiento real gratis, requiere CSP img-src + `api.cloudinary.com` y tests.
- 2026-09-18: rebase limpio, full lane verde, review nativo aprobado tras una corrección, PR #1307 mergeado (`a35d90c`), issue cerrado. Queda el deploy a staging + verificación end-to-end (dueño) y el registro en cata_club-docs (PR en curso).
