from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

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


def _es_secreto_inseguro(valor: str) -> bool:
    if not valor or len(valor) < 16:
        return True
    return any(p in valor for p in _PLACEHOLDERS_SECRETO)


class Settings(BaseSettings):
    """
    Configuración centralizada de la aplicación.
    En producción, estos valores se cargan desde variables de entorno (.env)
    y NUNCA se hardcodean (a diferencia del ejemplo inicial con SECRET_KEY fija).
    """
    app_nombre: str = "API Cata Club - UNL"
    app_version: str = "1.3.0"
    ambiente: str = "production"

    database_url: str = "postgresql+psycopg://usuario:password@localhost:5432/cataclub_db"

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
