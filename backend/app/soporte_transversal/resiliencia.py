"""
Política de resiliencia para llamadas a servicios externos (Cloudinary, SMTP,
gateway del chatbot) y para los workers de Celery.

Módulo PURO: solo constantes numéricas, CERO imports. La mecánica (cómo se
usan estos números contra cada SDK/transporte) vive en cada adaptador de
`app.infraestructura.*`, no acá. Esto mantiene un solo lugar de política y
deja la implementación de transporte donde corresponde (ver
`cloudinary_cliente.py::_timeout_cloudinary`, que arma un
`urllib3.util.Timeout` con los dos primeros valores y lo usan TODAS las
llamadas de red de ese módulo: las subidas y el borrado de logo).

Todo call site de timeout/retry del proyecto DEBE importar sus valores desde
este módulo. Ningún call site puede tener un literal numérico propio (hay una
prueba de guardia que lo verifica, ver `test_cloudinary_cliente.py`).
"""

# --- Cloudinary (ruta de request: voucher, foto de perfil, y logo de
# patrocinador tanto al subirlo como al borrarlo; ruta de tarea: PDF de
# membresía) -----------------------------------------------------------------
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
# 3 LLAMADAS fallidas seguidas, no una sola: una sola falla puede ser un
# glitch transitorio de un peer; 3 x el timeout total (~8s c/u, ~24s en
# total) alcanza para confirmar que el proveedor está caído de verdad, no
# que hubo una llamada floja. Cuentan las 4 subidas Y el borrado de logo de
# patrocinador (issue #838): comparten la misma instancia de breaker porque
# lo que se mide es si Cloudinary CONTESTA, no qué operación se le pidió --
# 3 borrados que se cuelgan prueban lo mismo que 3 subidas que se cuelgan.
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

# --- Circuit breaker del chatbot (issue #834) -------------------------------
# 3 consultas fallidas seguidas, mismo criterio que Cloudinary y SMTP: una
# sola falla puede ser un glitch del gateway, tres seguidas son una caída. Solo
# cuentan las fallas AJENAS al modelo -- un 404 `model_not_found` es una
# respuesta del gateway, así que prueba que está vivo (ver
# `chatbot_servicio._es_atribuible_al_modelo`) -- de modo que 3 acá significan
# 3 veces que no se pudo hablar con el proveedor, nunca 3 ids retirados.
CIRCUITO_CHATBOT_UMBRAL_FALLOS = 3

# Mayor al peor caso de pared de UNA consulta
# (`chatbot_servicio.PRESUPUESTO_TOTAL_SEGUNDOS` = 24s: 12s de timeout por
# intento por 1+1 reintentos), por el mismo motivo que
# `CIRCUITO_CLOUDINARY_COOLDOWN_SEGUNDOS`: una sonda en SEMIABIERTO tiene que
# terminar SIEMPRE antes de que se admita otra, y con un cooldown menor al
# presupuesto podrían quedar dos sondas en vuelo a la vez. 30s también acota lo
# que espera una persona a que el sistema vuelva a probar el gateway, y es el
# orden de magnitud de una interrupción típica del tier gratuito.
CIRCUITO_CHATBOT_COOLDOWN_SEGUNDOS = 30.0

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
