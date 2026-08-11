import ipaddress
from typing import Optional
from urllib.parse import urlparse

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Valor por defecto de `database_url`: sirve para levantar el proyecto local
# sin configurar nada, pero en producción apunta a un Postgres que no existe.
_DATABASE_URL_DE_EJEMPLO = "postgresql+psycopg://usuario:password@localhost:5432/cataclub_db"

# Usuario y contraseña de ejemplo, DERIVADOS de la URL de arriba en vez de
# repetidos como literales aparte. Son el mismo valor, y escribirlo dos veces
# deja que las dos copias se separen en silencio: alguien cambia la URL de
# ejemplo, el chequeo agnóstico al host de `_exigir_config_de_produccion` sigue
# comparando contra la vieja, y deja de atrapar lo que existe para atrapar.
_CREDENCIALES_DE_EJEMPLO = urlparse(_DATABASE_URL_DE_EJEMPLO)

# Piso de longitud para la contraseña de Postgres en producción. No pretende
# medir fuerza: descarta el olvido y el relleno de una o dos letras.
_LARGO_MINIMO_PASSWORD_DB = 8

# Único ambiente en el que los chequeos de fail-fast de `_exigir_config_de_produccion`
# están activos. En `development` y `test` un .env incompleto NUNCA debe
# impedir el arranque: convertir un olvido de configuración en un stack muerto
# es peor que el default inseguro que se está evitando.
_AMBIENTE_ESTRICTO = "production"


def urls_documentacion(ambiente: str) -> dict[str, Optional[str]]:
    """Rutas de la documentación interactiva según el ambiente.

    En producción se apagan las tres (`/docs`, `/redoc` y también
    `/openapi.json`: dejar el esquema servido revela toda la superficie de la
    API aunque Swagger UI no se renderice). Fuera de producción quedan
    encendidas a propósito — son útiles para demostrar y explorar la API.

    El healthcheck del contenedor backend NO depende de `/docs`: apunta a
    `/health` desde PR-09 (ver docker-compose.yml), así que apagarlas no
    rompe el deploy.
    """
    if ambiente == _AMBIENTE_ESTRICTO:
        return {"docs_url": None, "redoc_url": None, "openapi_url": None}
    return {"docs_url": "/docs", "redoc_url": "/redoc", "openapi_url": "/openapi.json"}

# Marcadores que indican que `jwt_secret_key` NO fue reemplazado por una clave
# real. Si el arranque detecta uno de ellos, lanza (fail-fast) para impedir
# firmar tokens con un secreto público que cualquiera puede reproducir.
_PLACEHOLDERS_SECRETO = (
    "CAMBIAR",
    "CAMBIAR-POR",
    "genera-una-clave",
    "dev-only",
    "do-not-use-in-production",
)


# Catchers de correo de desarrollo: interceptan TODO lo que se les envía y lo
# muestran en una UI local. `docker-compose.yml` inyecta
# `SMTP_HOST=${SMTP_HOST:-mailpit}`, así que quien no lo sobreescriba corre
# producción contra uno de estos. El envío tiene ÉXITO — no hay excepción, no
# hay log de error — y el correo de recuperación de contraseña desaparece en
# una bandeja que nadie lee. Se comparan en minúsculas.
_HOSTS_DE_CATCHER_DE_CORREO = ("mailpit", "mailhog")

# Únicos esquemas que sirven en un enlace incrustado en un correo: el cliente
# de correo del usuario tiene que poder abrirlo en un navegador.
_ESQUEMAS_PUBLICOS = ("http", "https")


def _es_secreto_inseguro(valor: str) -> bool:
    if not valor or len(valor) < 16:
        return True
    return any(p in valor for p in _PLACEHOLDERS_SECRETO)


def _normalizar_host_smtp(valor: str) -> str:
    """Reduce un `SMTP_HOST` escrito de cualquier forma a solo el hostname,
    en minúsculas y sin punto final.

    Existe porque comparar el valor CRUDO contra la lista de catchers era un
    falso negativo garantizado: `mailpit:1025`, `smtp://mailpit` y `mailpit.`
    resuelven al mismo catcher y ninguno coincidía literalmente.

    IPv6: un literal entre corchetes (`[::1]`, `[2001:db8::1]:587`) se
    desarma por los corchetes. Un literal SIN corchetes (`::1`) tiene más de
    un `:` y se deja pasar INTACTO a propósito — partirlo por el primer `:`
    lo destruiría, y ningún catcher de desarrollo se configura como IPv6.
    """
    host = valor.strip()
    # Prefijo `esquema://` opcional (smtp://, smtps://).
    if "://" in host:
        host = host.split("://", 1)[1]
    # Cualquier path o barra sobrante después del host.
    host = host.split("/", 1)[0]
    # Puerto opcional.
    if host.startswith("["):
        host = host[1:].split("]", 1)[0]
    elif host.count(":") == 1:
        host = host.split(":", 1)[0]
    return host.rstrip(".").lower()


def _es_catcher_de_correo(valor: str) -> bool:
    """True si `valor` apunta a un catcher de desarrollo (ver
    `_HOSTS_DE_CATCHER_DE_CORREO`).

    Compara ETIQUETAS completas, no subcadenas: coincide el host normalizado
    entero (`mailpit`) o su primera etiqueta (`mailpit.internal`,
    `mailhog.local`), pero NO un proveedor real que apenas contenga la
    palabra (`smtp.mailpitservice.com` pasa: su primera etiqueta es `smtp`).
    """
    host = _normalizar_host_smtp(valor)
    if not host:
        return False
    return (
        host in _HOSTS_DE_CATCHER_DE_CORREO
        or host.split(".", 1)[0] in _HOSTS_DE_CATCHER_DE_CORREO
    )


def _es_host_inalcanzable_desde_afuera(host: str) -> bool:
    """True si `host` solo tiene sentido dentro de la máquina que lo escribe.

    Se apoya en `ipaddress` en lugar de una lista literal: `is_loopback`
    cubre TODO `127.0.0.0/8` (no solo `127.0.0.1`) y `::1` de una sola vez.

    `is_unspecified` (`0.0.0.0`, `::`) también cuenta como inválido, decisión
    deliberada: son direcciones de BIND ("escuchá en todas las interfaces"),
    no de destino. Un navegador no puede abrirlas de forma útil, así que
    dentro de un correo son tan inservibles como localhost.
    """
    host = host.rstrip(".").lower()   # `localhost.` es el mismo host
    try:
        direccion = ipaddress.ip_address(host)
    except ValueError:
        # No es una IP: queda el caso por nombre.
        return host == "localhost" or host.endswith(".localhost")
    return direccion.is_loopback or direccion.is_unspecified


# Contrato de producción. TODO campo de `Settings` tiene que aparecer en
# EXACTAMENTE UNA de estas dos tablas: no hay tercera opción ni lista de
# excepciones. Agregar un campo obliga a decidir, y la decisión queda escrita
# (ver `tests/test_configuracion.py`).

# Campos que `_exigir_config_de_produccion` DEBE rechazar cuando quedan sin
# configurar. El valor es la variable de entorno tal como la escribe el
# operador y como aparece en el mensaje de error -- es también donde queda
# documentado el alias `cors_origenes_raw` -> `CORS_ORIGENES`.
_CAMPOS_PRODUCCION_CRITICOS: dict[str, str] = {
    "database_url": "DATABASE_URL",
    "cors_origenes_raw": "CORS_ORIGENES",
    "smtp_host": "SMTP_HOST",
    "frontend_url": "FRONTEND_URL",
    "cloudinary_cloud_name": "CLOUDINARY_CLOUD_NAME",
    "cloudinary_api_key": "CLOUDINARY_API_KEY",
    "cloudinary_api_secret": "CLOUDINARY_API_SECRET",
}

# Razón compartida por el usuario y la contraseña de SMTP: es la MISMA
# decisión y antes estaba escrita dos veces, la segunda como "idem smtp_user".
# Una constante evita que las dos copias se despeguen cuando alguien edite una
# sola, que es exactamente lo que pasa con las referencias cruzadas en prosa.
_RAZON_SMTP_SIN_AUTENTICACION = (
    "hay relays de producción legítimos SIN autenticación (Postfix local); "
    "exigirlo sería un falso positivo, misma asimetría deliberada que la del "
    "host SMTP (ver el docstring de `_problemas_de_smtp`)"
)

# Campos deliberadamente FUERA del fail-fast. La razón es obligatoria y se
# revisa en el PR: es lo único que distingue "vacío legítimo" de "olvidado".
_CAMPOS_EXCLUIDOS_A_PROPOSITO: dict[str, str] = {
    "app_nombre": "metadato de presentación; ningún despliegue depende de su valor",
    "app_version": "metadato que fija el repositorio, no el despliegue",
    "ambiente": "es la LLAVE que activa este propio validador; exigirlo acá sería circular",
    "jwt_secret_key": (
        "ya lo valida _secreto_jwt_debe_ser_real de forma INCONDICIONAL "
        "(:148), en todos los ambientes: es más estricto que producción y "
        "exigirlo acá duplicaría el error"
    ),
    "jwt_algoritmo": "constante de la aplicación (HS256), no un valor por despliegue",
    "jwt_expira_minutos": "política de sesión con default seguro; int, nunca queda vacío",
    "jwt_refresh_expira_dias": "idem jwt_expira_minutos: política de sesión con default seguro",
    "redis_url": (
        "coordenada de red interna fijada en docker-compose.yml "
        "(redis://redis:6379/0), no un secreto por despliegue"
    ),
    "celery_broker_url": "vacío es VÁLIDO: broker_url_efectivo (:213) cae a redis_url",
    "celery_result_backend": "vacío es VÁLIDO: result_backend_efectivo (:217) cae a redis_url",
    "celery_result_expira_segundos": "default operativo (24h), independiente del despliegue",
    "celery_hora_automatizaciones": "default operativo (02:30 hora local), independiente del despliegue",
    "cloudinary_carpeta_comprobantes": (
        "nombre de carpeta dentro de la cuenta de Cloudinary; el default es "
        "correcto y no es un secreto"
    ),
    "cloudinary_carpeta_vouchers": "idem carpeta de comprobantes: nombre de carpeta, no un secreto",
    "cloudinary_carpeta_fotos_perfil": "idem carpeta de comprobantes: nombre de carpeta, no un secreto",
    "cloudinary_auth_token_key": (
        "opcional: habilita vencimiento real en las URLs firmadas de "
        "comprobantes/vouchers (token-based authentication de Cloudinary), "
        "pero sin ella el código ya degrada con seguridad a una URL firmada "
        "sin vencimiento (ver cloudinary_cliente.generar_url_firmada); "
        "exigirla en producción bloquearía despliegues que todavía no "
        "habilitaron esa función opcional en la cuenta de Cloudinary"
    ),
    "smtp_port": "int con default 587; el compose lo fija por despliegue y no puede quedar vacío",
    "smtp_user": _RAZON_SMTP_SIN_AUTENTICACION,
    "smtp_password": _RAZON_SMTP_SIN_AUTENTICACION,
    "smtp_from": (
        "default utilizable; una dirección equivocada no se puede detectar "
        "al arrancar, solo la rechaza el proveedor"
    ),
    "smtp_starttls": (
        "bool con default seguro (True); el riesgo real es que el compose "
        "lo pise, y eso lo cubre docker-compose.prod.yml + "
        "tests/test_docker_compose_config.py"
    ),
    "opencode_api_key": (
        "el chatbot de FAQ es una función OPCIONAL: ChatbotServicio "
        "(chatbot_servicio.py:147) ya acota los fallos upstream a "
        "429/502/504 en tiempo de request, y docker-compose.yml:110 pasa "
        "${OPENCODE_API_KEY:-}, o sea que vacío es una configuración "
        "esperada. Exigirlo negaría el arranque de TODO el backend por una "
        "función que el club puede no habilitar"
    ),
    "reset_hosts_permitidos_raw": (
        "solo lo consume scripts/reset_dev_db.py, que nunca corre en "
        "producción; su propia allow-list incondicional lo valida"
    ),
}


# --- Chequeos de producción, uno por preocupación ----------------------------
# Cada función devuelve los problemas que encontró, o una lista vacía. Viven
# acá afuera y no dentro de `_exigir_config_de_produccion` porque ese validador
# terminó haciendo cinco cosas sin relación entre sí en un mismo cuerpo: se
# volvió difícil de leer y de ejercitar por separado. Separadas, el validador
# queda como lo que realmente es — una lista de políticas — y cada política se
# entiende sola. Los mensajes son los mismos de siempre, palabra por palabra.

_CAMPOS_CLOUDINARY = (
    "cloudinary_cloud_name",
    "cloudinary_api_key",
    "cloudinary_api_secret",
)


def _problemas_de_database_url(database_url: str) -> list[str]:
    if not database_url.strip() or database_url == _DATABASE_URL_DE_EJEMPLO:
        return [
            "DATABASE_URL sigue siendo la URL de ejemplo del repo; define "
            "la cadena de conexión real del Postgres de producción."
        ]

    # Chequeo agnóstico al host, independiente del anterior:
    # `docker-compose.yml` compone DATABASE_URL como
    # `${POSTGRES_USER:-usuario}:${POSTGRES_PASSWORD:-password}@db:5432/...`.
    # Esa URL renderizada difiere de `_DATABASE_URL_DE_EJEMPLO` SOLO en el host
    # (`db` vs `localhost`), así que la comparación de arriba nunca la atrapa y
    # un despliegue real puede arrancar con las credenciales de ejemplo del
    # repo. Comparar usuario y contraseña por separado lo detecta sin importar
    # el host.
    credenciales = urlparse(database_url)
    if (
        credenciales.username == _CREDENCIALES_DE_EJEMPLO.username
        and credenciales.password == _CREDENCIALES_DE_EJEMPLO.password
    ):
        return [
            "DATABASE_URL usa las credenciales de ejemplo del repo "
            f"('{_CREDENCIALES_DE_EJEMPLO.username}'/"
            f"'{_CREDENCIALES_DE_EJEMPLO.password}'); define "
            "POSTGRES_USER y POSTGRES_PASSWORD reales antes de "
            "desplegar."
        ]
    if (
        not credenciales.password
        or len(credenciales.password) < _LARGO_MINIMO_PASSWORD_DB
    ):
        return [
            "DATABASE_URL tiene una contraseña vacía o demasiado "
            "corta; define una contraseña real y suficientemente "
            "larga para el Postgres de producción."
        ]
    return []


def _problemas_de_cors(origenes: list[str]) -> list[str]:
    if not origenes:
        return [
            "CORS_ORIGENES está vacío; define los orígenes del frontend "
            "(CSV, ej: https://cataclub.com)."
        ]
    return []


def _problemas_de_smtp(smtp_host_crudo: str) -> list[str]:
    """Correo transaccional. Sin esto la recuperación de contraseña se rompe
    EN SILENCIO en producción: nadie recibe un error.

    Asimetría deliberada con FRONTEND_URL: acá NO se rechaza localhost ni
    127.0.0.1. Un Postfix o relay corriendo en la misma máquina es un patrón
    legítimo de producción, y bloquearlo sería un falso positivo que obliga al
    operador a pelearse con el arranque.
    """
    smtp_host = smtp_host_crudo.strip()
    if not smtp_host:
        return [
            "SMTP_HOST está vacío; define el servidor SMTP real (ej: "
            "smtp.sendgrid.net) o la recuperación de contraseña fallará "
            "en el primer intento."
        ]
    if _es_catcher_de_correo(smtp_host):
        return [
            f"SMTP_HOST apunta a '{smtp_host}', un catcher de correo de "
            "desarrollo: el envío tiene éxito pero el correo nunca llega "
            "al usuario. Define el servidor SMTP real de producción."
        ]
    return []


def _problemas_de_frontend_url(frontend_url_crudo: str) -> list[str]:
    """FRONTEND_URL sí rechaza localhost, y la razón es la que justifica la
    asimetría con SMTP: esta URL no la marca el servidor, se incrusta en un
    correo que se abre en el dispositivo de OTRA persona. Ahí localhost es
    inequívocamente incorrecto — el enlace de `/reset-password?token=...`
    muere al llegar.
    """
    frontend_url = frontend_url_crudo.strip()
    if not frontend_url:
        return [
            "FRONTEND_URL está vacío; define la URL pública del frontend "
            "(ej: https://cataclub.com) o los enlaces de recuperación de "
            "contraseña saldrán sin host."
        ]

    # Primero: ¿es siquiera una URL ABSOLUTA y abrible? La pregunta NO es "¿el
    # host está en una lista negra?" — preguntarlo así era el bug: `urlparse`
    # devuelve `hostname=None` para todo valor sin esquema, y ese None nunca
    # coincide con ninguna lista, así que `cataclub.com` (el operador olvida
    # `https://`) y `localhost:3000` (donde `localhost` se parsea como
    # ESQUEMA) pasaban intactos y el correo salía con un enlace muerto.
    partes = urlparse(frontend_url)
    if partes.scheme.lower() not in _ESQUEMAS_PUBLICOS or not partes.hostname:
        return [
            f"FRONTEND_URL='{frontend_url}' no es una URL absoluta "
            "utilizable: falta el esquema http/https o el host. El "
            "valor se incrusta tal cual en el correo de recuperación, "
            "así que sin esquema el enlace no abre. Define la URL "
            "completa (ej: https://cataclub.com)."
        ]
    if _es_host_inalcanzable_desde_afuera(partes.hostname):
        return [
            f"FRONTEND_URL apunta a '{frontend_url}': ese enlace viaja "
            "dentro del correo de recuperación y no abre en el "
            "dispositivo del usuario (localhost, loopback o dirección "
            "de bind). Define la URL pública del frontend "
            "(ej: https://cataclub.com)."
        ]
    return []


def _problemas_de_cloudinary(valores: dict[str, str]) -> list[str]:
    """Sin estas 3 credenciales, cualquier subida de un comprobante, voucher o
    foto de perfil falla en tiempo de request en vez de al arrancar."""
    problemas: list[str] = []
    for campo, valor in valores.items():
        if not valor.strip():
            variable_env = _CAMPOS_PRODUCCION_CRITICOS[campo]
            problemas.append(
                f"{variable_env} está vacío; define la credencial real de "
                "Cloudinary o las subidas de archivos (comprobantes, "
                "vouchers, fotos de perfil) fallarán en el primer intento."
            )
    return problemas


class Settings(BaseSettings):
    """
    Configuración centralizada de la aplicación.
    En producción, estos valores se cargan desde variables de entorno (.env)
    y NUNCA se hardcodean (a diferencia del ejemplo inicial con SECRET_KEY fija).
    """
    app_nombre: str = "API Cata Club - UNL"
    app_version: str = "1.3.0"
    ambiente: str = "production"

    database_url: str = _DATABASE_URL_DE_EJEMPLO

    jwt_secret_key: str = "CAMBIAR_EN_.env_POR_UNA_CLAVE_SEGURA"
    jwt_algoritmo: str = "HS256"
    jwt_expira_minutos: int = 60
    jwt_refresh_expira_dias: int = 7

    @field_validator("jwt_secret_key")
    @classmethod
    def _secreto_jwt_debe_ser_real(cls, v: str) -> str:
        """Defensa en depth: si alguien olvidó sobreescribir el placeholder
        de JWT_SECRET_KEY, el arranque falla en lugar de firmar tokens con un
        secreto público y predecible."""
        if _es_secreto_inseguro(v):
            raise ValueError(
                "JWT_SECRET_KEY no es seguro: es muy corto o contiene un "
                "placeholder ('CAMBIAR...', 'genera-una-clave...'). Define una "
                "clave larga y aleatoria en .env (ej: `openssl rand -hex 32`)."
            )
        return v

    # CORS: el campo crudo del .env, como string. `cors_origenes` (la lista
    # parseada que usa main.py) se expone vía @property abajo. Aceptar CSV en
    # .env hace más amigable configurarlo (sin JSON):
    #   CORS_ORIGENES=http://localhost:3000,https://cataclub.com
    # También se acepta JSON de PydanticSettings si se prefiere:
    #   CORS_ORIGENES=["http://localhost:3000","https://cataclub.com"]
    # El alias mapea el env var CORS_ORIGENES (sin sufijo _RAW) a este campo.
    cors_origenes_raw: str = Field(default="http://localhost:3000", alias="CORS_ORIGENES")

    # --- Redis / Celery ---
    # Se usa como broker y result backend de Celery, y como caché compartida.
    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str = ""   # si vacío, se derivation de redis_url
    celery_result_backend: str = ""
    celery_result_expira_segundos: int = 60 * 60 * 24  # 24h
    celery_hora_automatizaciones: str = "02:30"  # HH:MM (Hora local) para tareas diarias

    # --- Cloudinary ---
    cloudinary_cloud_name: str = ""
    cloudinary_api_key: str = ""
    cloudinary_api_secret: str = ""
    # carpeta dentro de Cloudinary donde se guardan los comprobantes PDF
    cloudinary_carpeta_comprobantes: str = "cataclub/comprobantes"
    # carpeta separada para los vouchers de transferencia que adjunta el cliente
    # (no es el PDF oficial generado al aprobar un pago — ese va a comprobantes)
    cloudinary_carpeta_vouchers: str = "cataclub/vouchers"
    # carpeta separada para las fotos de perfil self-service de cada Persona
    cloudinary_carpeta_fotos_perfil: str = "cataclub/fotos_perfil"
    # Clave de "token-based authentication" (Cloudinary Console > Settings >
    # Security), DISTINTA de cloudinary_api_secret. Habilita el vencimiento
    # real de las URLs firmadas de comprobantes/vouchers (ver
    # `cloudinary_cliente.generar_url_firmada`); sin ella, la URL queda
    # firmada pero sin vencimiento -- ver docs/fixes/16-voucher-no-enumerable.md.
    cloudinary_auth_token_key: str = ""

    # --- Correo / SMTP (envío transaccional) ---
    smtp_host: str = ""                       # ej. smtp.gmail.com, smtp.sendgrid.net o mailpit
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = "no-reply@cataclub.com"
    smtp_starttls: bool = True
    frontend_url: str = "http://localhost:3000"  # base para enlaces de recuperación

    # --- Chatbot de FAQ (gateway OpenCode Zen, OpenAI-compatible) ---
    opencode_api_key: str = ""

    # --- Reset de la base de datos de desarrollo (backend/scripts/reset_dev_db.py) ---
    # Hosts que el script de reset tiene permitido destruir (DROP SCHEMA).
    # Allow-list INCONDICIONAL: ni siquiera `--forzado` puede saltarla (ver
    # `validar_reset_permitido`). "db" es el hostname real del servicio
    # Postgres en docker-compose.yml. CSV, mismo patrón que `cors_origenes_raw`.
    reset_hosts_permitidos_raw: str = Field(
        default="localhost,127.0.0.1,db", alias="RESET_HOSTS_PERMITIDOS"
    )

    @property
    def broker_url_efectivo(self) -> str:
        return self.celery_broker_url or self.redis_url

    @property
    def result_backend_efectivo(self) -> str:
        return self.celery_result_backend or self.redis_url

    @property
    def cors_origenes(self) -> list[str]:
        """Lista de orígenes permitidos para CORS, parseada desde el .env.
        Acepta CSV y JSON; descarta vacíos. REEMPLAZA al antiguo campo
        list[str]`cors_origenes` que rompía al leer CSV desde .env porque
        PydanticSettings intentaba parsearlo como JSON."""
        raw = self.cors_origenes_raw.strip()
        if not raw:
            return []
        # JSON: empieza con '[' -> parsear y devolver la lista (si es lista).
        if raw.startswith("["):
            import json
            try:
                parsed = json.loads(raw)
                if isinstance(parsed, list):
                    return [str(x).strip() for x in parsed if str(x).strip()]
            except json.JSONDecodeError:
                pass
        # CSV: partir por coma.
        return [p.strip() for p in raw.split(",") if p.strip()]

    @property
    def reset_hosts_permitidos(self) -> list[str]:
        """Lista de hosts permitidos para `scripts/reset_dev_db.py`, parseada
        desde CSV (ver `reset_hosts_permitidos_raw`)."""
        return [h.strip() for h in self.reset_hosts_permitidos_raw.split(",") if h.strip()]

    @model_validator(mode="after")
    def _exigir_config_de_produccion(self) -> "Settings":
        """Fail-fast SOLO con `AMBIENTE=production`.

        Estos ajustes tienen un default cómodo para desarrollo que en
        producción es directamente inseguro o inservible: apuntar al Postgres
        de ejemplo, quedarse sin orígenes CORS (lo que deja al frontend sin
        poder hablar con la API y suele "arreglarse" a las apuradas con un
        comodín), mandar el correo a un catcher de desarrollo o incrustar
        enlaces a localhost en correos que se abren en otro dispositivo.
        Fallar acá, al arrancar, es preferible a fallar en la primera petición
        real — o peor, a NO fallar y perder los correos en silencio.

        Condicionado a producción a propósito: en `development` y `test` este
        validador NO se ejecuta, así que un `.env` incompleto sigue
        arrancando igual que antes de este cambio (ver
        `tests/test_configuracion.py`).
        """
        if self.ambiente != _AMBIENTE_ESTRICTO:
            return self

        faltantes = [
            *_problemas_de_database_url(self.database_url),
            *_problemas_de_cors(self.cors_origenes),
            *_problemas_de_smtp(self.smtp_host),
            *_problemas_de_frontend_url(self.frontend_url),
            *_problemas_de_cloudinary(
                {campo: getattr(self, campo) for campo in _CAMPOS_CLOUDINARY}
            ),
        ]

        if faltantes:
            raise ValueError(
                "Configuración de producción incompleta (AMBIENTE=production): "
                + " ".join(faltantes)
            )
        return self

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        # Permite que el env var CORS_ORIGENES alimente el campo
        # `cors_origenes_raw` vía su alias "CORS_ORIGENES".
        populate_by_name=True,
        # Algunos scripts (ej. seed_dev_bulk.py) leen sus propias env vars
        # (SEED_VOUCHER_BASE_URL) directo de os.environ sin pasar por acá.
        # Sin "ignore", cualquier var así presente en .env tira extra_forbidden
        # y tumba el arranque de toda la app por una var que ni siquiera usa
        # este modelo.
        extra="ignore",
    )


settings = Settings()
