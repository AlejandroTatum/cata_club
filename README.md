# Cata Club Admin

Sistema integral de administración para el Club de Tenis de Mesa — gestión de membresías, validación de pagos, asistencia, ranking y más.

Proyecto de la materia **Diseño de Software** — Universidad Nacional de Loja (UNL).

## Arquitectura

```
cata_club/
├── backend/          # Python 3.13 · FastAPI · SQLAlchemy 2 · PostgreSQL · Celery
├── frontend/         # Next.js 14 · React 18 · TypeScript · Tailwind CSS
├── docker-compose.yml
├── Makefile
└── README.md
```

| Capa | Stack |
|------|-------|
| Frontend | Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS, Vitest, Playwright |
| Backend | Python 3.13, FastAPI, Pydantic v2, SQLAlchemy 2, Alembic, Celery + Redis |
| Base de datos | PostgreSQL 16 |
| Infraestructura | Docker, Docker Compose |

## Requisitos Previos

- [Python 3.13+](https://www.python.org/downloads/)
- [Node.js 18+](https://nodejs.org/)
- [Docker](https://docs.docker.com/get-docker/)
- [pnpm](https://pnpm.io/installation) (`corepack enable && corepack prepare pnpm@latest --activate`)
- [uv](https://docs.astral.sh/uv/getting-started/installation/) (gestor de paquetes Python)

## Inicio Rápido

### 1. Configurar variables de entorno

```bash
cp .env.example .env
# Editar .env y generar un JWT_SECRET_KEY seguro:
openssl rand -hex 32
```

### 2. Levantar todo con Docker

```bash
docker compose up -d
```

Esto levanta: PostgreSQL, Redis, backend (FastAPI), Celery worker, Celery beat, y frontend (Next.js).

- Frontend: [http://localhost:3000](http://localhost:3000)
- Backend API: [http://localhost:8000/docs](http://localhost:8000/docs) (Swagger)

### 3. Desarrollo local (sin Docker)

**Backend:**
```bash
cd backend
uv sync
cp .env.example .env    # Configurar DATABASE_URL y JWT_SECRET_KEY
uv run uvicorn main:app --reload
```

**Frontend:**
```bash
cd frontend
pnpm install
pnpm dev
```

## Comandos Comunes (Make)

```bash
make help             # Ver todos los comandos disponibles
make dev              # Levantar backend + frontend en desarrollo
make test             # Correr todos los tests (backend + frontend)
make lint             # Lint de ambos proyectos
make docker-up        # Levantar con Docker Compose
make docker-down      # Detener todos los servicios
```

Ver `Makefile` para la lista completa.

## Estructura del Backend

Arquitectura limpia por capas (Clean Architecture) con patrón Repository + Service Layer:

```
backend/app/
├── dominio/              # Entidades ORM, enums, excepciones de dominio
├── infraestructura/      # Repositorios, conexión DB, Celery tasks, Cloudinary
├── servicios_negocio/    # Lógica de negocio (usa repos, NO conoce FastAPI)
├── seguridad/            # JWT + bcrypt
├── presentacion/         # Routers (API) + Schemas (DTOs Pydantic)
└── soporte_transversal/  # Configuración centralizada, rate limiting
```

**33 endpoints** · **19 entidades** · **39 tests** (pytest + SQLite en memoria).

Ver `backend/README.md` para documentación completa.

## Estructura del Frontend

Next.js 14 App Router con patrón BFF (Backend-for-Frontend):

```
frontend/src/
├── app/          # Páginas + Route Handlers (BFF)
├── components/   # Componentes React reutilizables
├── contexts/     # React Context (auth state)
├── controllers/  # Contratos de controllers
├── lib/          # Utilidades + adaptadores server-side
├── services/     # API client, auth mock
└── types/        # Tipos TypeScript del dominio
```

Ver `frontend/README.md` para documentación completa.

## Testing

```bash
# Backend (pytest, SQLite en memoria)
cd backend && uv run pytest tests/ -v

# Frontend (Vitest unit + Playwright E2E)
cd frontend && pnpm test
cd frontend && pnpm exec playwright test
```

## Modelo de Dominio

El sistema gestiona un club de tenis de mesa con:

- **Personas** con roles (Administrador, Entrenador, Responsable de Pago, Alumno)
- **Membresías** con tipos (Mensual, Personalizada) y ciclo de vida (Activa/Vencida/Inactiva)
- **Pagos** con validación de comprobantes (CU012)
- **Asistencia** a sesiones de entrenamiento con registro por horario
- **Ranking** por niveles con asignación y movimiento de alumnos
- **Clases extra** para membresías personalizadas
- **Fichas médicas** y antecedentes del club
- **Automatizaciones** (Celery Beat): alertas de vencimiento de membresía y marcado automático de membresías vencidas

## Despliegue

Ver `frontend/Dockerfile` y `backend/Dockerfile` para las imágenes de producción. El frontend usa modo `standalone` de Next.js.

## Licencia

Proyecto académico — ver [LICENSE](LICENSE).
