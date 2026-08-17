# Inventario de configuración por variable

Fuente canónica de **todas** las variables de entorno del sistema, por
componente y entorno, con required/default/secret/origen. Reemplaza al
relevamiento a mano de los históricos (que quedó incompleto): si una
variable no está acá, no se usa.

> **Estado:** Activa
>
> **Responsable:** Desarrollo (asignación nominal pendiente — ver
> [`ownership.md`](ownership.md))
>
> **Audiencia:** desarrollo y operación
>
> **Última verificación:** 2026-08-17 · **Verificado contra commit:** `d6a18fe`
>
> **Revisión recomendada:** con cada cambio en `docker-compose*.yml`, `configuracion.py`, `check-env.mjs` o los `.env.example`

**Fuentes leídas:** `docker-compose.yml`, `docker-compose.prod.yml`,
`docker-compose.override.yml`, `docker-compose.qa.yml`, `.env.example`,
`backend/.env.example`, `frontend/.env.local.example`, `.env.production.example`,
`backend/app/soporte_transversal/configuracion.py`,
`frontend/scripts/check-env.mjs`, `Caddyfile`.

## Convenciones

- **Secret:** variable cuyo valor no debe versionarse ni exponerse. Este
  documento **no copia valores** de ningún `.env` local.
- **Origen:** dónde se consume la variable. «Compose» = interpolación en
  `docker-compose*.yml`; «Settings» = `configuracion.py`; «check-env» =
  `frontend/scripts/check-env.mjs`; «Caddy» = interpolación del Caddyfile.
- Un mismo valor suele declararse en el `.env` raíz (que lee Compose) y
  llegar al backend como `environment:` del servicio.

## Raíz / Compose (`.env` raíz)

Leído por Compose. Los defaults seguros de desarrollo viven en
`docker-compose.yml`; producción los exige sin default.

| Variable | Required | Default | Secret | Origen | Notas |
|---|---|---|---|---|---|
| `POSTGRES_USER` | prod | `usuario` (dev) | prod | Compose → Settings | Fail-fast de producción rechaza `usuario` |
| `POSTGRES_PASSWORD` | prod | `password` (dev) | **sí** | Compose → Settings | Fail-fast: vacía o < 8 chars rechazada en prod |
| `POSTGRES_DB` | — | `cataclub_db` | no | Compose | |
| `JWT_SECRET_KEY` | **siempre** | — (sin default, `:?`) | **sí** | Compose → Settings | Validado en todos los ambientes; placeholder/corto aborta el arranque. Generar: `openssl rand -hex 32` |
| `AMBIENTE` | — | `production` | no | Compose → Settings | `development` activa seed + `crear_tablas`; `production` activa fail-fast y apaga `/docs`; `test` desactiva rate limiting |
| `CORS_ORIGENES` | **prod** | `http://localhost:3000` (dev) | no | Compose → Settings | CSV o JSON; prod sin default (`:?`) |
| `SMTP_HOST` | **prod** | `mailpit` (dev) | no | Compose → Settings | Fail-fast: vacío o catcher (mailpit/mailhog) rechazado en prod |
| `SMTP_PORT` | prod | `1025` (dev) / `587` en Settings | no | Compose → Settings | |
| `SMTP_USER` / `SMTP_PASSWORD` | opcional | vacío | **sí** | Compose → Settings | Relays legítimos sin auth existen; no exigidos |
| `SMTP_FROM` | — | `no-reply@cataclub.com` | no | Compose → Settings | |
| `SMTP_STARTTLS` | prod | `false` (dev) / `true` en prod | no | Compose prod → Settings | Prod fuerza default `true` |
| `FRONTEND_URL` | **prod** | `http://localhost:3000` (dev) | no | Compose → Settings | Fail-fast: absoluta http/https, no loopback (viaja en correos) |
| `CLOUDINARY_CLOUD_NAME` | **prod** | vacío | no | Compose → Settings | Fail-fast en prod |
| `CLOUDINARY_API_KEY` | **prod** | vacío | **sí** | Compose → Settings | Fail-fast en prod |
| `CLOUDINARY_API_SECRET` | **prod** | vacío | **sí** | Compose → Settings | Fail-fast en prod |
| `OPENCODE_API_KEY` | opcional | vacío | **sí** | Compose → Settings | Chatbot de FAQ; vacío = función deshabilitada |
| `IMAGE_TAG` | opcional | `latest` | no | Compose | Tag de las imágenes GHCR; **producción debe fijarlo por SHA** (ver `operations/deployment.md`) |
| `DOMINIO` | **prod** | — (`:?`) | no | Compose prod → Caddy | Host del certificado TLS |
| `ACME_EMAIL` | **prod** | — (`:?`) | no | Compose prod → Caddy | Contacto de Let's Encrypt |

> **A-2 cerrado (2026-08-17):** los `.env.example` se alinearon con este
> inventario (`IMAGE_TAG`, `FRONTEND_URL`, `SMTP_*`, `RESET_HOSTS_PERMITIDOS`,
> `TEST_DATABASE_URL`, `CLOUDINARY_AUTH_TOKEN_KEY`) y existe
> `.env.production.example` como plantilla dedicada de producción (ver
> [`operations/deployment.md`](../operations/deployment.md)).

## Backend (`Settings` — `configuracion.py`)

Además de las de la tabla anterior (llegan como `environment:` del
servicio), el backend lee las siguientes. El alias `RESET_HOSTS_PERMITIDOS`
solo lo consume `scripts/reset_dev_db.py`.

| Variable | Required | Default | Secret | Notas |
|---|---|---|---|---|
| `DATABASE_URL` | prod | URL de ejemplo (dev) | **sí** (password embebida) | Fail-fast en prod: URL real, credenciales no-`usuario`/`password`, password ≥ 8 |
| `REDIS_URL` | — | `redis://localhost:6379/0` (compone en el stack: `redis://redis:6379/0`) | no | Broker/result backend de Celery y caché |
| `CELERY_BROKER_URL` / `CELERY_RESULT_BACKEND` | opcional | vacío → derivan de `REDIS_URL` | no | |
| `CELERY_RESULT_EXPIRA_SEGUNDOS` | — | `86400` (24 h) | no | |
| `CELERY_HORA_AUTOMATIZACIONES` | — | `02:30` | no | HH:MM hora local de las tareas diarias |
| `JWT_ALGORITMO` | — | `HS256` | no | |
| `JWT_EXPIRA_MINUTOS` | — | `60` | no | |
| `JWT_REFRESH_EXPIRA_DIAS` | — | `7` | no | |
| `CLOUDINARY_CARPETA_COMPROBANTES` | — | `cataclub/comprobantes` | no | |
| `CLOUDINARY_CARPETA_VOUCHERS` | — | `cataclub/vouchers` | no | |
| `CLOUDINARY_CARPETA_FOTOS_PERFIL` | — | `cataclub/fotos_perfil` | no | |
| `CLOUDINARY_AUTH_TOKEN_KEY` | opcional | vacío | **sí** | Habilita vencimiento de URLs firmadas (token-based auth de Cloudinary) |
| `RESET_HOSTS_PERMITIDOS` | — | `localhost,127.0.0.1,db` | no | Allow-list del reset destructivo; CSV |
| `SEED_VOUCHER_BASE_URL` | — | placeholder | no | Solo `scripts/seed_dev_bulk.py` (lee de `os.environ`) |
| `APP_NOMBRE` / `APP_VERSION` | — | `API Cata Club - UNL` / `1.3.0` | no | Metadatos de presentación |
| `TEST_DATABASE_URL` | solo tests | `postgresql+psycopg://usuario:password@localhost:5436/cataclub_test` (Makefile) | no | Contrato único de la suite: `make test-backend` y CI la fijan; `AMBIENTE` y `JWT_SECRET_KEY` los pone `backend/tests/conftest.py` |

## Frontend

| Variable | Required | Default | Secret | Origen | Notas |
|---|---|---|---|---|---|
| `BACKEND_API_URL` | **sí** (dev y runtime) | — | no | `check-env.mjs` (dev/start) + Compose | Server-only, sin prefijo `NEXT_PUBLIC_`; URL base del backend (`http://backend:8000/api/v1` en el stack) |
| `NEXT_PUBLIC_USE_MOCKS` | build | `false` en el Dockerfile; `true` si queda sin definir | no | build ARG → bundle | Solo elige el header `x-mock-role` de los handlers mock; ya no elige la URL (siempre same-origin BFF). Debe quedar `"false"` |
| `NEXT_PUBLIC_API_URL` | — | `http://localhost:8000/api/v1` | no | build ARG | **Inerte en runtime** (no se lee en `src/`); solo existe como ARG del Dockerfile |
| `NEXT_PUBLIC_APP_NAME` | — | `Cata Club Admin` | no | build ARG → `<title>` | |

## Caddy (interpolación del Caddyfile)

| Variable | Required | Default | Secret | Notas |
|---|---|---|---|---|
| `DOMINIO` | **prod** | — | no | Host del `reverse_proxy` y TLS; la inyecta Compose prod |
| `ACME_EMAIL` | **prod** | — | no | `email` global para Let's Encrypt |

## Reglas de fail-fast de producción (resumen)

Con `AMBIENTE=production`, el backend **no arranca** si:
`DATABASE_URL` no es real (o usa `usuario`/`password`/password corta),
`CORS_ORIGENES` vacío, `SMTP_HOST` vacío o catcher, `FRONTEND_URL` no
absoluta o loopback, o falta alguna de las 3 credenciales de Cloudinary.
Además, Compose prod exige `CORS_ORIGENES`, `DOMINIO` y `ACME_EMAIL` en el
render. `JWT_SECRET_KEY` se valida en todos los ambientes. Los valores de
prueba del CI (`*.ci.invalid`) existen solo para pasar estos validadores y
nunca pueden enviar correo ni emitir certificados reales.

## Dónde vive cada archivo de entorno

| Archivo | Git | Lo lee |
|---|---|---|
| `.env` (raíz) | no | Compose |
| `backend/.env` | no | Settings (CWD del backend; en el contenedor las inyecta Compose) |
| `frontend/.env.local` | no | Next.js + `check-env.mjs` |
| `.env.production.example` | sí | Referencia; plantilla de producción (ver [`operations/deployment.md`](../operations/deployment.md)) |
| `*.env.example` | sí | Referencia; no los consume ningún proceso |
