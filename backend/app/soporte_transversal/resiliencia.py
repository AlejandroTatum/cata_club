"""
Política de resiliencia para llamadas a servicios externos (Cloudinary, SMTP)
y para los workers de Celery.

Módulo PURO: solo constantes numéricas, CERO imports. La mecánica (cómo se
usan estos números contra cada SDK/transporte) vive en cada adaptador de
`app.infraestructura.*`, no acá. Esto mantiene un solo lugar de política y
deja la implementación de transporte donde corresponde (ver
`cloudinary_cliente.py::_subir`, que arma un `urllib3.util.Timeout` con los
dos primeros valores).

Todo call site de timeout/retry del proyecto DEBE importar sus valores desde
este módulo. Ningún call site puede tener un literal numérico propio (hay una
prueba de guardia que lo verifica, ver `test_cloudinary_cliente.py`).
"""

# --- Cloudinary (ruta de request: voucher, foto de perfil; ruta de tarea:
# PDF de membresía) ----------------------------------------------------------
# Un handshake TCP+TLS contra un CDN global termina bien por debajo de 1s o no
# termina. Un connect fallido no cuesta nada: no se envió ningún byte.
TIMEOUT_CLOUDINARY_CONEXION_SEGUNDOS = 3.0

# Deja ~2s de margen bajo el techo de abort del BFF (`BACKEND_TIMEOUT_MS =
# 10_000`, `bff-helpers.ts:19`) para la escritura en BD, la serialización y el
# salto BFF↔backend. 5 MB en 8s requiere ~5 Mbit/s de egreso del host — un
# piso que cualquier entorno hosteado supera salvo un peer degradado. Se
# comparte entre ruta de request (≤5 MB) y ruta de tarea (~50 KB de PDF):
# ver razonamiento en el diseño (Decisión 3) sobre por qué NO conviene un
# valor separado y más largo para el PDF, más chico.
TIMEOUT_CLOUDINARY_TOTAL_SEGUNDOS = 8.0

# Instrumentación, NO un límite: no aborta nada, solo decide si el `logger`
# registra la subida como `info` o como `warning`. Deliberadamente es el valor
# que la propuesta original quería IMPONER; acá se opta por medirlo primero.
UMBRAL_SUBIDA_LENTA_SEGUNDOS = 4.0

# --- Circuit breaker Cloudinary (degradacion-controlada, slice 2) -----------
# 3 subidas fallidas seguidas, no una sola: una sola falla puede ser un
# glitch transitorio de un peer; 3 x el timeout total (~8s c/u, ~24s en
# total) alcanza para confirmar que el proveedor está caído de verdad, no
# que hubo una subida floja.
CIRCUITO_CLOUDINARY_UMBRAL_FALLOS = 3

# Mayor al timeout total (8s), para que una sonda en SEMIABIERTO siempre
# termine antes de que se admita otra sonda: con un cooldown menor al
# timeout, dos sondas podrían quedar en vuelo al mismo tiempo. Con 30s, una
# persona espera como máximo 30s a que el sistema vuelva a probar.
CIRCUITO_CLOUDINARY_COOLDOWN_SEGUNDOS = 30.0

# --- URL firmada de entrega (comprobantes/vouchers, hallazgo de privacidad
# "voucher no enumerable") ---------------------------------------------------
# Vigencia de la URL firmada que `cloudinary_cliente.generar_url_firmada`
# entrega SOLO cuando la cuenta tiene token-based authentication habilitada
# (`settings.cloudinary_auth_token_key`); sin esa clave, Cloudinary firma
# pero no vence (ver docstring de esa función). 15 minutos: alcanza para que
# un admin revise una fila de la cola de validación o para que una familia
# abra el link desde una notificación, sin dejar una URL utilizable por
# tiempo indefinido si se filtra.
CLOUDINARY_URL_FIRMADA_VIGENCIA_SEGUNDOS = 900

# --- SMTP --------------------------------------------------------------------
# Valor histórico de `notificaciones_servicio.py`, sin cambios, ahora
# nombrado. `smtplib` lo aplica POR operación de socket (connect/starttls/
# login/sendmail), así que un SMTP totalmente degradado puede demorar ~40s
# por destinatario — de ahí que el límite blando de Celery de abajo sea 300s
# y no 60s.
TIMEOUT_SMTP_SEGUNDOS = 10.0

# --- Circuit breaker SMTP (degradacion-controlada, slice 3) -----------------
# 3 fallos de TRANSPORTE consecutivos, no uno solo: un socket flojo aislado
# puede ser un glitch; solo cuentan fallas de transporte reales (nunca un
# destinatario rechazado, ver Decisión D del diseño), así que 3 seguidas
# confirman que el relay está caído, no que hubo 3 direcciones malas en el
# mismo lote.
CIRCUITO_SMTP_UMBRAL_FALLOS = 3

# Mayor al costo peor-caso por destinatario (~40s, TIMEOUT_SMTP_SEGUNDOS por
# cada operación de socket: connect/starttls/login/sendmail), para que el
# circuito no "aletee" (abra/cierre) en medio de un lote. Con 60s, 3
# reintentos del lote (Decisión B del diseño) cubren ~180s de ventana de
# recuperación, y una sonda en SEMIABIERTO siempre entra dentro del límite
# blando de 300s de abajo.
CIRCUITO_SMTP_COOLDOWN_SEGUNDOS = 60.0

# --- Celery: límites de tiempo de worker -------------------------------------
# Dimensionado para el PEOR batch, no para una subida individual: el límite
# blando debe sobrevivir a `alertar_vencimientos_hoy_mas_5`
# (`alertas_tareas.py:73-86`), que abre una conexión SMTP nueva por
# destinatario y puede acumular ~40s cada una si el SMTP está degradado.
CELERY_LIMITE_BLANDO_SEGUNDOS = 300

# Brecha de 60s sobre el límite blando: ventana de limpieza para que
# `SoftTimeLimitExceeded` desenrolle los bloques `with SessionLocal()` y
# `autoretry_for` alcance a programar el reintento antes del SIGKILL duro.
# Además, DEBE quedar por debajo de los 900s del intervalo más corto del beat
# (`reconciliar_comprobantes_faltantes`, `crontab(minute="*/15")`,
# `celery_app.py`) para que una corrida trabada no se solape con su propia
# sucesora.
CELERY_LIMITE_DURO_SEGUNDOS = 360
