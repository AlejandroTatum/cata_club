# Cata Club Backend

API del sistema de administración del Club de Tenis de Mesa: membresías,
validación de pagos, asistencia, fichas médicas, inscripción pública y más.
Arquitectura limpia por capas con patrón Repository + Service Layer.

> **Estado:** Activa
>
> **Responsable:** Desarrollo backend (asignación nominal pendiente — ver
> [`../docs/reference/ownership.md`](../docs/reference/ownership.md))
>
> **Audiencia:** desarrolladores del backend
>
> **Última verificación:** 2026-08-13 · **Verificado contra commit:** `fd9f7be`
>
> **Revisión recomendada:** con cada cambio de routers, dominio o configuración

## Stack

Python 3.13 · FastAPI · Pydantic v2 · SQLAlchemy 2 · PostgreSQL 16 · Alembic ·
Celery + Redis · uv. Los tests corren contra **Postgres real** (servicio
`db-test`), no contra SQLite.

## Inicio rápido

**Opción recomendada: todo el stack con Docker Compose** (desde la raíz del
repo — ver [`../README.md`](../README.md)):

```bash
cp .env.example .env        # y generar JWT_SECRET_KEY: openssl rand -hex 32
docker compose up -d
```

El backend queda en [http://localhost:8000](http://localhost:8000) y su
Swagger en [http://localhost:8000/docs](http://localhost:8000/docs)
(solo fuera de producción).

**Solo backend, local:**

```bash
cd backend
uv sync
cp .env.example .env        # configurar DATABASE_URL y JWT_SECRET_KEY
uv run uvicorn main:app --reload
```

### Tests

```bash
# Postgres de test (servicio del perfil "test"; publica en 127.0.0.1:5436)
docker compose --profile test up -d db-test
make test-backend           # o: cd backend && uv run pytest tests/ -v
```

`make test-backend` fija `TEST_DATABASE_URL` (default
`localhost:5436/cataclub_test`). `AMBIENTE` y `JWT_SECRET_KEY` las pone
`backend/tests/conftest.py` con `setdefault` — es el único lugar donde vive
el contrato de entorno de la suite. Ver también `make test-compose`
(validación del layering de producción) y el job `migraciones-desde-cero`
de CI.

## Arquitectura

```
backend/
├── app/
│   ├── presentacion/          # Routers + Schemas (DTOs Pydantic) — sin SQL ni reglas
│   │   └── routers/           # auth, personas, membresias_pagos, descuentos,
│   │                          # asistencias, ficha_medica, geografia,
│   │                          # notificaciones, enrollment, dashboard, chatbot
│   ├── servicios_negocio/     # Reglas de negocio; usa repos, no conoce FastAPI
│   ├── seguridad/             # JWT, hashing, gestión de sesiones y permisos
│   ├── dominio/               # Entidades ORM (modelos.py), enums, excepciones
│   ├── infraestructura/       # db.py, repositorios (única capa con queries),
│   │                          # tareas Celery, clientes externos (Cloudinary, SMTP)
│   └── soporte_transversal/   # configuracion.py (Settings), rate_limit, circuito_breaker
├── alembic/                   # Migraciones versionadas (versions/)
├── scripts/                   # entrypoint.sh, seeds, reset_dev_db.py
└── tests/                     # Suite pytest
```

**Flujo de una petición:** el Router recibe el DTO → instancia el Servicio →
el Servicio aplica reglas y llama al Repositorio → el Repositorio ejecuta
SQLAlchemy → ante una falla, el Servicio lanza una excepción de dominio → un
manejador global en `main.py` la traduce a HTTP. El router no ve
`HTTPException` ni `db.query`.

**Routers montados** (todos bajo `/api/v1`): `auth`, `personas`,
`membresias_pagos`, `descuentos`, `asistencias`, `ficha_medica`, `geografia`,
`notificaciones`, `enrollment`, `dashboard`, `chatbot`. El listado exacto de
endpoints está en `/docs` (no se mantiene un conteo en este README: es
volátil).

## Dominio

Personas con roles (Administrador, Entrenador, Responsable de Pago, Alumno),
representantes y autogestionados · membresías con tipos y ciclo de vida ·
pagos con validación de comprobantes y vouchers · horarios de entrenamiento
y asistencia · categorías de horario · fichas médicas · notificaciones ·
inscripción pública (`enrollment`) · geografía. La feature de
ranking/niveles **se removió** (`#165`); hoy las categorías de horario la
reemplazan.

## Configuración

Toda la configuración está centralizada en
`app/soporte_transversal/configuracion.py` (pydantic-settings). En
producción (`AMBIENTE=production`) el arranque es fail-fast: rechaza
`DATABASE_URL` de ejemplo, `CORS_ORIGENES` vacío, `SMTP_HOST` catcher,
`FRONTEND_URL` loopback y credenciales de Cloudinary ausentes. `JWT_SECRET_KEY`
se valida en todos los ambientes. Inventario completo de variables:
[`../docs/reference/configuration.md`](../docs/reference/configuration.md).

## Migraciones

- `make migrate` → `alembic upgrade head`.
- El entrypoint del contenedor (`scripts/entrypoint.sh`) corre
  `alembic upgrade head` en cada arranque con `set -eu`: si la migración
  falla, el backend **no** arranca.
- CI verifica la cadena `empty → head` en cada PR (job
  `migraciones-desde-cero`).
- Reset destructivo de desarrollo: `make db-reset` (allow-list de hosts,
  ver `scripts/RUNBOOK_reset_db.md`).

## Salud y operación

| Ruta | Rol | Qué mide |
|---|---|---|
| `GET /health` | anónimo | Liveness, sin dependencias |
| `GET /health/ready` | anónimo | Readiness: Postgres + Redis (503 si una cae) |
| `GET /diagnostico/circuitos` | ADMINISTRADOR | Estado de los circuit breakers (Cloudinary, SMTP) |

Correlación de requests: toda respuesta lleva `X-Request-ID`. Rate limiting
por endpoint (usuario autenticado o IP). Runbooks: [`../docs/operations/`](../docs/operations/).

## Portal documental

Índice completo de la documentación (operación, configuración, ownership,
privacidad): [`../docs/README.md`](../docs/README.md). Estado de preparación
para producción: [`../docs/operations/production-readiness.md`](../docs/operations/production-readiness.md).
