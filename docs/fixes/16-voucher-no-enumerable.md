# Fix 16 · El comprobante bancario era una URL pública y enumerable

- **Cierra:** hallazgo de privacidad "voucher no enumerable" (bloqueante, reportado directamente para esta tanda, sin id de la auditoría QA — ver `docs/fixes/BRIEF.md` y el prompt del hallazgo)
- **Decisión que lo gobierna:** no hay una entrada específica en `docs/decisiones-de-negocio-2026-08-11.md` para este hallazgo (es un bloqueante de seguridad, no un ítem de la auditoría de producto); sí aplica su §7 ("Un pago sin comprobante sobrevive en el historial"), que este fix no puede romper — ver la sección "La prueba"
- **Rama:** fix/voucher-no-enumerable
- **Commits:**
  - `c7a6837` — fix(cloudinary): upload vouchers and comprobantes as authenticated
  - `b8c5248` — fix(pagos): persist voucher/comprobante public_id, not the raw URL
  - `c8c929d` — test(pagos): lock voucher/comprobante urls to authenticated delivery

## El problema

El comprobante bancario que sube una familia (y el PDF oficial que genera el club al aprobar un pago) se subían a Cloudinary con un `public_id` secuencial (`voucher-pago-00000011`, `comprobante-00000005`) y sin ninguna restricción de acceso. El backend sí exige autorización para *consultar* un pago por API, pero el archivo nunca pasaba por esa puerta: alguien que viera un comprobante legítimo aprendía el `cloud_name` y podía bajarse el de cualquier otra familia con solo cambiar el número, sin loguearse ni pasar ningún chequeo.

No hay captura de este hallazgo: es un bloqueante de backend puro (una URL, sin pantalla propia) y, además, Cloudinary no tiene credenciales configuradas en este entorno de QA — no hay forma de subir un archivo real para fotografiar el "antes". La evidencia es la corrida de tests contra Postgres real, más abajo.

## Qué se hizo

Se adoptó el primer camino que ofrece el hallazgo: **`type="authenticated"` con URL firmada, generada por el backend después de verificar quién pide.**

1. **Subida.** `subir_voucher_pago` y `subir_pdf_membresia` (`backend/app/infraestructura/cloudinary_cliente.py`) ahora suben el recurso como `type="authenticated"`. Sin firma válida, Cloudinary devuelve 401 — el `public_id` puede seguir siendo secuencial (no hace falta ofuscarlo) porque ya no alcanza con conocerlo.
2. **Qué se persiste.** `Pago.voucher_url` y `ComprobantePago.archivo_url` (el nombre de columna no cambió, para no migrar el esquema) ahora guardan el `public_id`, NO la URL que devuelve el SDK — esa URL, con `type="authenticated"`, ya no sirve sin firmar, y firmarla en el momento de subir la dejaría vencida (o eternamente vigente) esperando en la fila en vez de reflejar el momento real en que alguien autorizado la pide.
3. **Qué se entrega.** `cloudinary_cliente.generar_url_firmada` firma localmente (con el `api_secret` de la cuenta, sin red) una URL de entrega fresca en cada lectura. `PagoServicio._url_entrega_voucher` / `pago_a_response_dto` envuelven cada endpoint que devuelve un `Pago` al cliente (`GET /pagos/{id}`, `GET /pagos/persona/{id}`, `PATCH /pagos/{id}/validar`, `POST /pagos/{id}/voucher`, y la cola `GET /pagos`) para que la firma se genere DESPUÉS de que la autorización ya pasó, nunca antes.
4. **Vencimiento real, si la cuenta lo soporta.** Cloudinary ofrece "token-based authentication" para URLs que además vencen a los N segundos — es una función opcional de la cuenta, no algo que este código pueda activar por su cuenta. Se agregó el setting opcional `cloudinary_auth_token_key`: si está configurado, la URL vence a los 15 minutos (`CLOUDINARY_URL_FIRMADA_VIGENCIA_SEGUNDOS`, `resiliencia.py`); si no, la URL queda igual firmada (nadie sin el `api_secret` puede construir una que Cloudinary acepte) pero sin vencer.

Se descartó cambiar solo el `public_id` a algo aleatorio sin más: seguiría siendo una URL pública que, filtrada una vez, sirve para siempre — exactamente lo que el hallazgo señala como insuficiente. También se descartó mover la entrega completa detrás del backend (proxy de bytes): el camino elegido logra el mismo resultado (nadie ve el archivo sin autorización) sin que el backend tenga que leer y reenviar bytes de Cloudinary en cada visualización.

**ComprobantePago** (el PDF oficial) tenía el mismo problema estructural y entra en el mismo arreglo (punto 1 y 2). No se agregó una ruta de lectura firmada para él porque, a diferencia del voucher, **hoy ningún endpoint expone `ComprobantePago.archivo_url`** — el único lugar donde se genera es la tarea de Celery, cuyo valor de retorno no llega a ningún cliente HTTP. Cerrar la subida ya cierra la enumeración; si en el futuro se agrega un endpoint de lectura, debe pasar por `resolver_url_entrega` igual que el voucher.

## El candado

**Unitario** (firma y comportamiento de `generar_url_firmada`/`resolver_url_entrega`) — `backend/tests/test_cloudinary_cliente.py`, tests 10 y 11 (`test_voucher_y_comprobante_se_suben_como_type_authenticated`, `test_url_firmada_no_es_igual_a_una_url_publica_de_upload`, `test_url_firmada_con_clave_de_token_agrega_vencimiento_real`, `test_resolver_url_entrega_de_una_fila_previa_al_fix_no_se_toca`, etc.)

**End-to-end** (la URL que ve el cliente HTTP) — `backend/tests/test_voucher_pago.py::test_subir_voucher_jpg_a_pago_pendiente_devuelve_201`, con verificación directa en Postgres:

```
# Antes del fix (RED) -- código madre, tests ya escritos
FAILED tests/test_voucher_pago.py::test_subir_voucher_jpg_a_pago_pendiente_devuelve_201
FAILED tests/test_voucher_pago.py::test_subir_voucher_pdf_a_pago_pendiente_devuelve_201
FAILED tests/test_ownership_pagos.py::test_representante_si_sube_voucher_del_pago_de_su_representado
FAILED tests/test_pago_comprobante_atomico.py::test_genera_comprobante_sin_carrera_ni_comprobante_previo

AssertionError: assert 'https://res.cloudinary.com/test/image/upload/voucher-fake.jpg' != 'https://res.cloudinary.com/test/image/upload/voucher-fake.jpg'
# -- la URL que veía el cliente ERA, literalmente, la que devolvió el SDK al subir.

4 failed, 18 passed, 1 warning in 1.81s

# Después del fix (GREEN)
$ cd backend && TEST_DATABASE_URL=postgresql+psycopg://usuario:password@localhost:5436/cataclub_test \
  pytest tests/test_cloudinary_cliente.py tests/test_voucher_pago.py tests/test_ownership_pagos.py \
         tests/test_pago_comprobante_atomico.py tests/test_configuracion.py -q
123 passed, 1 warning in 2.06s
```

## La prueba

Sin captura (ver nota en "El problema"): no hay pantalla propia y Cloudinary no tiene credenciales en este entorno para subir un archivo real. La prueba es la verificación directa contra Postgres (no solo la respuesta HTTP), dentro de `test_subir_voucher_jpg_a_pago_pendiente_devuelve_201`:

```python
fila = db_session.get(Pago, pago["id"])
assert fila.voucher_url == f"voucher-pago-{pago['id']:08d}"   # el public_id, no una URL
assert not fila.voucher_url.startswith("http")
```

Y la respuesta HTTP, que sí entrega una URL usable, pero firmada y de `type="authenticated"`:

```
body["voucherUrl"] == "https://res.cloudinary.com/test-cloud/image/authenticated/s--XXXXXXXX--/voucher-pago-00000001"
```

(la firma `s--XXXXXXXX--` cambia en cada corrida porque `sign_url=True` incluye la versión del recurso en el hash).

El flujo que el fix no podía romper (decisión de negocio §7: un pago sin comprobante sobrevive en el historial con botón de reintento) queda fijado en `test_subir_voucher_tras_fallo_de_cloudinary_permite_reintentar`: la subida falla (503), `Pago.voucher_url` queda en `None` en Postgres, y un segundo intento sin el fallo se completa con éxito.

## Lo que NO cambió

- **Los comprobantes ya subidos antes de este fix.** Sus filas guardan la URL pública completa de un recurso `type="upload"` (sin firmar) — `resolver_url_entrega` las detecta por el prefijo `http` y las devuelve tal cual, sin romperlas. Siguen siendo públicas y enumerables: es historial de pagos de familias reales y este código no puede repararlas solo, porque repararlas significa volver a subir cada archivo bajo `type="authenticated"` con las credenciales reales de Cloudinary — ausentes en este entorno. **Queda pendiente una migración de datos** (re-subir cada `voucher_url`/`archivo_url` que empiece con `http` y reemplazar la fila por el `public_id` nuevo) para cuando haya credenciales reales; hasta entonces, el riesgo original sigue vigente para esas filas puntuales, no para las nuevas.
- **Vencimiento real de la URL firmada.** Requiere habilitar "token-based authentication" en la cuenta de Cloudinary (Console > Settings > Security) y configurar `CLOUDINARY_AUTH_TOKEN_KEY`; sin eso, la URL queda firmada (cierra la enumeración pública, que era el bloqueante) pero no vence sola. No pudo probarse contra una cuenta real por la misma falta de credenciales — el test que cubre esa rama (`test_url_firmada_con_clave_de_token_agrega_vencimiento_real`) verifica que el código arma el pedido correcto al SDK, no que Cloudinary lo acepte.
- El contrato HTTP no cambió de forma: `voucherUrl` sigue siendo un string que el frontend renderiza tal cual (`<img src>`, `<a href>`) — no hizo falta tocar el frontend.
- La validación de tipo MIME, firma binaria y tamaño máximo del voucher (5 MB) sigue exactamente igual, antes de llegar a Cloudinary.
- El flujo de reintento tras una subida fallida (comprobante marcado, botón para volver a subirlo desde la fila) sigue funcionando — ver "La prueba".
- La foto de perfil (`subir_foto_perfil`) no entra en este fix: no es un comprobante bancario y el hallazgo no la menciona.
- No se subió el stack de QA ni se corrió contra Cloudinary real: no hay credenciales configuradas en este entorno (ver nota en "El problema"). Toda la evidencia es contra el `TestClient` de FastAPI + Postgres real de `db-test`, sin red hacia Cloudinary en ningún test.
