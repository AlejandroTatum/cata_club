# Cata Club Admin

Sistema integral de administración para el Club de Tenis de Mesa — gestión de membresías, validación de pagos, asistencia, ranking y más.

Proyecto de la materia **Diseño de Software** — Universidad Nacional de Loja (UNL).

## Mapa del repositorio

Si es tu primera vez acá, leé esta sección y nada más. El repositorio tiene
**cuatro carpetas y tres archivos** que importan; todo lo demás cuelga de ahí.

```
cata_club/
├── backend/     El servidor. Guarda los datos y decide qué puede hacer cada persona.
├── frontend/    Las pantallas. Todo lo que un socio, un entrenador o un admin ve y toca.
├── tests/       Pruebas que no son ni del servidor ni de las pantallas, sino del armado.
├── DESIGN.md    Las reglas visuales: colores, tipografías, medidas. Manda sobre el código.
├── Makefile     Los atajos. `make help` los lista todos.
└── CLAUDE.md    Cómo se trabaja en este repo: ramas, commits, pull requests.
```

La documentación (decisiones, manuales de operación, historia) vive en un
repo aparte: **[`cata_club-docs`](https://github.com/AlejandroTatum/cata_club-docs)**.

### ¿Qué estás buscando?

| Si buscás… | Andá a |
|---|---|
| Levantar el sistema en tu máquina | [Inicio Rápido](#inicio-rápido), más abajo |
| Un entorno de prueba con datos de mentira | [Entorno de QA](#entorno-de-qa) — un comando, `make qa-up` |
| Cómo se ve cada pantalla, antes y después del rediseño | [`ux/comparaciones/`](https://github.com/AlejandroTatum/cata_club-docs/blob/main/ux/comparaciones/README.md) |
| Por qué una pantalla usa ese color o esa letra | [`DESIGN.md`](DESIGN.md) |
| Qué se le prometió al club y por cuánto | [`product/`](https://github.com/AlejandroTatum/cata_club-docs/tree/main/product) |
| Poner el sistema en producción | [`operations/deployment.md`](https://github.com/AlejandroTatum/cata_club-docs/blob/main/operations/deployment.md) |
| Redeploy manual de staging | [`docs/operations/staging-redeploy.md`](docs/operations/staging-redeploy.md) |
| Qué falta antes de lanzar | [`operations/production-readiness.md`](https://github.com/AlejandroTatum/cata_club-docs/blob/main/operations/production-readiness.md) |
| Qué significa cada variable de entorno | [`reference/configuration.md`](https://github.com/AlejandroTatum/cata_club-docs/blob/main/reference/configuration.md) |
| Quién aprueba qué | [`reference/ownership.md`](https://github.com/AlejandroTatum/cata_club-docs/blob/main/reference/ownership.md) |
| Qué datos personales guardamos y por cuánto tiempo | [`security/privacy-retention.md`](https://github.com/AlejandroTatum/cata_club-docs/blob/main/security/privacy-retention.md) |
| Algo que se hizo antes y ya no está vigente | [`archive/`](https://github.com/AlejandroTatum/cata_club-docs/blob/main/archive/README.md) |
| El índice completo de la documentación | [`cata_club-docs`](https://github.com/AlejandroTatum/cata_club-docs) |

### Dónde NO buscar

- **`node_modules/`, `coverage/`, `test-results/`, `.next/`** — los genera la
  máquina y no se versionan. Si los ves, ignoralos.
- **`.claude/`, `.impeccable/`** — estado local de herramientas. Aparecen en tu
  disco, no en el repositorio.

### El stack, para quien lo necesite

| Capa | Stack |
|------|-------|
| Frontend | Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS, Vitest, Playwright |
| Backend | Python 3.13, FastAPI, Pydantic v2, SQLAlchemy 2, Alembic, Celery + Redis |
| Base de datos | PostgreSQL 16 |
| Infraestructura | Docker, Docker Compose |

El detalle de cada lado está más abajo, en [Estructura del
Backend](#estructura-del-backend) y [Estructura del
Frontend](#estructura-del-frontend).

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

**Tests:** la suite pytest corre contra **Postgres real** (servicio
`db-test` de Compose, vía `TEST_DATABASE_URL`), no contra SQLite; los
conteos de endpoints, entidades y tests no se mantienen en este README por
ser volátiles. Ver `backend/README.md` para la documentación completa.

## Estructura del Frontend

Next.js 14 App Router con patrón BFF (Backend-for-Frontend):

```
frontend/src/
├── app/          # Páginas + Route Handlers (BFF)
├── components/   # Componentes React reutilizables
├── contexts/     # React Context (auth state)
├── controllers/  # Contratos de controllers
├── lib/          # Utilidades + adaptadores server-side
├── services/     # Cliente HTTP (BFF) — ver services/README.md
└── types/        # Tipos TypeScript del dominio
```

Ver `frontend/README.md` para documentación completa.

## Entorno de QA

Stack desechable, sembrado y reproducible para QA manual y para los E2E que
atraviesan un backend real. Un solo comando lo levanta desde cero:

```bash
make qa-up
```

Cuando el comando vuelve, el stack ya responde: construye las imágenes con el
código actual, aplica las migraciones, corre `seed_dev_base.py` y después
`seed_dev_bulk.py`, y espera a que pasen los healthchecks.

- Frontend: [http://localhost:3000](http://localhost:3000)
- Backend API: [http://localhost:8000/docs](http://localhost:8000/docs)
- Correos capturados: [http://localhost:8025](http://localhost:8025)

Credenciales sembradas:

| Rol | Correo | Contraseña |
|-----|--------|------------|
| Administrador | `admin@cataclub.com` | `admin12345` |
| Entrenador | `entrenador@cataclub.com` | `trainer12345` |
| Alumnos y representantes del dataset grande | ver `/members` | `alumno123` |

Después de sembrar hay alumnos distribuidos en las categorías de horario
(`Mensual Infantil` / `Mensual Adultos`), membresías en los tres estados,
pagos con cola de validación y asistencias cargadas, así que las pantallas
se pueden evaluar con densidad realista en vez de con estados vacíos. No
hace falta `.env`: `make qa-up` inyecta una
`JWT_SECRET_KEY` aleatoria por corrida y `docker-compose.qa.yml` fija
`AMBIENTE=development`.

### Aislamiento

El entorno usa su propio nombre de proyecto de Compose (`cataclub-qa`), así que
tiene contenedores, red y volúmenes separados del stack de desarrollo. Su
Postgres vive en `tmpfs`: no existe volumen donde sobrevivan datos, de modo que
un error durante las pruebas no puede tocar datos reales.

Publica los mismos puertos que `make dev`, así que los dos son alternativas:
pará el stack de desarrollo (`make docker-down`) antes de levantar el de QA.

### Resetear y destruir

```bash
make qa-reset   # Volver al estado recien sembrado, sin reconstruir imagenes
make qa-seed    # Re-sembrar solo el dataset grande
make qa-logs    # Seguir los logs
make qa-down    # Destruir contenedores, red y datos
```

`make qa-reset` usa `backend/scripts/reset_dev_db.py`; el detalle de sus guards
está en `backend/scripts/RUNBOOK_reset_db.md`.

## Testing

Corré primero el test más enfocado que cubra tu cambio. Antes de subir una
rama o abrir un PR, elegí una lane explícita:

| Cambio | Comando | Cubre localmente |
|---|---|---|
| Backend o migraciones | `make pre-pr LANE=backend` | Guard de `.env` trackeados, Ruff, import-linter, pip-audit, pytest sobre PostgreSQL real y todos los tests raíz. |
| Frontend | `make pre-pr LANE=frontend` | Guard de `.env` trackeados, audit, typecheck, lint, una sola corrida con cobertura, build y Playwright E2E. |
| Compose, scripts raíz o CI config | `make pre-pr LANE=integration` | Guard de `.env` trackeados y todos los tests raíz, incluido el contrato de Compose; no reproduce la paridad de imágenes de producción. |
| Cambio transversal | `make pre-pr LANE=full` | Guard de `.env` trackeados, lane backend y lane frontend. |

`make pre-pr` sin `LANE`, o con una lane desconocida, falla antes de correr
checks. Cada lane válida ejecuta el guard de `.env` trackeados exactamente una
vez. Las lanes requieren las dependencias locales ya instaladas y Docker para
la lane backend. El preflight inicia `db-test` si hace falta; la suite usa
PostgreSQL real en el puerto `5436`, no SQLite, y ese servicio es single-tenant.

La lane backend exige `age` antes de iniciar los tests para que los controles de
backup de los tests raíz no queden salteados. Instalalo por fuera de la
verificación si falta; la lane no modifica toolchains. La lane frontend tampoco
instala dependencias ni navegadores: una vez por máquina (y de nuevo solo si
cambia la versión de Playwright), ejecutá antes:

```bash
cd frontend
pnpm install
pnpm exec playwright install chromium
```

Si falta una dependencia o Chromium, la lane falla con un mensaje de setup en
vez de descargar o instalar durante la verificación.

### Límites de la verificación local

Las lanes son predictivas, no una afirmación de paridad total con GitHub
Actions. `integration` se limita a los contratos raíz y de Compose: no reproduce
el job `docker-images` (build y arranque de la pila de producción, diagnósticos y
publicación en GHCR). Tampoco reproduce `migraciones-desde-cero` contra su
servicio PostgreSQL vacío y aislado. Registrá esos gates exactos como omitidos
en la evidencia del cambio. Después del push, el monitoreo remoto de CI lo hace
el agente de fondo de Pi `gentle-ai-monitor`, no un target de Make;
`gentle-ai-verify` se limita a la verificación local.

### E2E contra el backend real

`pnpm exec playwright test` corre la suite que mockea la API con `page.route`:
no necesita Docker y prueba el render del cliente. Los specs `*.live.spec.ts`
son los que atraviesan un backend de verdad y verifican lo que pasa *después*
de un envío (toast de éxito y estado persistido tras recargar). Requieren el
entorno de QA de la sección anterior; con el stack listo, ejecutá `make qa-live`.

Quedan fuera de la suite por defecto a propósito: `playwright.config.ts` solo
declara el proyecto `e2e-live` cuando `E2E_LIVE=1`.

## Modelo de Dominio

El sistema gestiona un club de tenis de mesa con:

- **Personas** con roles (Administrador, Entrenador, Responsable de Pago, Alumno)
- **Membresías** con tipos (Mensual, Personalizada) y ciclo de vida (Activa/Vencida/Inactiva)
- **Pagos** con validación de comprobantes (CU012)
- **Asistencia** a sesiones de entrenamiento con registro por horario
- **Categorías de horario** y asignación de alumnos a horarios
- **Clases extra** para membresías personalizadas
- **Fichas médicas** y antecedentes del club
- **Automatizaciones** (Celery Beat): alertas de vencimiento de membresía y marcado automático de membresías vencidas

## Despliegue

Ver `frontend/Dockerfile` y `backend/Dockerfile` para las imágenes de
producción. El frontend usa modo `standalone` de Next.js. El procedimiento
de despliegue, rollback y backup vive en
[`operations/`](https://github.com/AlejandroTatum/cata_club-docs/tree/main/operations) — empezar por
[`operations/production-readiness.md`](https://github.com/AlejandroTatum/cata_club-docs/blob/main/operations/production-readiness.md).

Los controles ejecutables provider-neutral están en este checkout:
[`docs/operations/provisioning.md`](docs/operations/provisioning.md) documenta
preflight, releases y rollback guardado; [`docs/operations/staging-redeploy.md`](docs/operations/staging-redeploy.md)
contiene el runbook ejecutable para redeploy manual de staging; y
[`docs/operations/monitoring.md`](docs/operations/monitoring.md) documenta los
dos monitores externos (readiness HTTPS y heartbeat del backup y de Celery, en
UptimeRobot) y deja explícito que la réplica off-host sigue pendiente.

## Documentación

El índice completo (operación, configuración, ownership, privacidad y
evidencia) vive en el repo aparte
[`cata_club-docs`](https://github.com/AlejandroTatum/cata_club-docs). Si no
sabés por dónde empezar, el [mapa del repositorio](#mapa-del-repositorio) al
principio de este archivo tiene una tabla de «si buscás X, andá a Y».

Tres reglas que evitan buscar en el lugar equivocado:

1. **Lo vigente vive en la raíz de `cata_club-docs`**; lo superado, en
   [`archive/`](https://github.com/AlejandroTatum/cata_club-docs/blob/main/archive/README.md). El archivo no se actualiza nunca.
2. **`DESIGN.md` manda sobre el código visual**, no al revés. Si una pantalla
   contradice a `DESIGN.md`, la pantalla está mal.
3. **Un comentario no es documentación.** El estado real se deriva corriendo un
   comando; la prosa dentro de un archivo puede haber quedado vieja.

## Licencia

Proyecto académico — ver [LICENSE](LICENSE).
