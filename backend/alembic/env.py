"""
Configuración de Alembic para Cata Club.

Notas de diseño:
  - La URL de la BD NO se hardcodea en `alembic.ini`; se toma de
    `app.soporte_transversal.configuracion.settings.database_url` (cargada
    desde .env). Así las migraciones usan la misma fuente de configuración
    que el resto de la app.
  - `target_metadata` apunta a `Base.metadata` del modelo ORM, para que
    `--autogenerate` detecte diferencias contra el esquema actual.
  - render_as_batch=True para soportar SQLite en desarrollo sin errores al
    alterar tablas (no aplica a Postgres producción, pero es inocuo).
"""
from logging.config import fileConfig

from sqlalchemy import engine_from_config
from sqlalchemy import pool

from alembic import context

from app.soporte_transversal.configuracion import settings
from app.dominio.modelos import Base


# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Sobrescribir la URL de la BD con la configurada en settings (.env),
# ignorando cualquier valor en alembic.ini (que queda como placeholder).
config.set_main_option("sqlalchemy.url", settings.database_url)

# Interpret the config file for Python logging.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# MetaData del ORM -> autogenerate compara contra este target.
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    Configura el contexto con solo una URL (sin Engine).
    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        render_as_batch=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def _ejecutar_migraciones(connection) -> None:
    """Configura el contexto sobre una conexión ya abierta y corre."""
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        render_as_batch=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    Crea un Engine y asocia una conexión al contexto, SALVO que quien invoca
    ya haya puesto una conexión en `config.attributes["connection"]` (receta
    estándar de Alembic para ejecución programática). Ese caso lo usa el
    arnés de migraciones de los tests (`backend/tests/arnes_migraciones.py`)
    para apuntar a su base de datos efímera sin tener que mutar el singleton
    `settings` ni variables de entorno globales del proceso.
    """
    connection = config.attributes.get("connection")
    if connection is not None:
        _ejecutar_migraciones(connection)
        return

    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        _ejecutar_migraciones(connection)


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
