# Cata Club Frontend

Aplicación web del Club de Tenis de Mesa: administración (membresías,
pagos, asistencia, grupos, descuentos, reportes), panel del entrenador y
portal del estudiante/representante. Next.js 14 (App Router) con patrón
**BFF**: el navegador solo habla con Route Handlers same-origin de Next.js,
y esos handlers conversan con la API FastAPI del backend.

> **Estado:** Activa
>
> **Responsable:** Desarrollo frontend (asignación nominal pendiente — ver
> [`../docs/reference/ownership.md`](../docs/reference/ownership.md))
>
> **Audiencia:** desarrolladores del frontend
>
> **Última verificación:** 2026-08-13 · **Verificado contra commit:** `fd9f7be`
>
> **Revisión recomendada:** con cada cambio de rutas, auth o del cliente API

## Stack

Next.js 14 (App Router) · React 18 · TypeScript (strict) · Tailwind CSS 3 ·
Vitest · Playwright · pnpm 10.

## Inicio rápido

El frontend local (`pnpm dev`) y el contenedor `frontend` de Compose compiten
por el puerto 3000: son **alternativas excluyentes**.

### Opción A — stack completo (todo en Docker)

Desde la raíz del repo (ver [`../README.md`](../README.md)):

```bash
docker compose up -d
```

Levanta frontend, backend, db, redis, celery y mailpit; el frontend queda en
http://localhost:3000. **No** correr `pnpm dev` encima (el 3000 ya lo ocupa el contenedor).

### Opción B — frontend local + dependencias en Docker

No existe un perfil que excluya al frontend: se levantan los servicios que
necesita (igual que `make dev-backend`), sin `frontend`:

```bash
# Desde la raíz del repo
docker compose up -d db redis backend celery-worker celery-beat

# Después, el frontend en modo desarrollo
cd frontend
pnpm install
cp .env.local.example .env.local   # BACKEND_API_URL apunta al backend local
pnpm dev                            # http://localhost:3000
```

`pnpm dev` corre `scripts/check-env.mjs` antes de arrancar: **falla en el
boot** si falta `BACKEND_API_URL` (server-only, no puede tener default).
`NEXT_PUBLIC_API_URL` es un build ARG del Dockerfile y es **inerte en
runtime**: no se lee en `src/`.

### Entorno de QA (desde la raíz)

```bash
make qa-up      # stack desechable y sembrado: backend real, frontend, correos
```

Credenciales sembradas: `admin@cataclub.com` / `admin12345`,
`entrenador@cataclub.com` / `trainer12345`, alumnos del dataset grande con
`alumno123`. Detalle en el [`../README.md`](../README.md).

## Arquitectura

```
frontend/
├── src/
│   ├── app/                    # Páginas (App Router) + Route Handlers BFF en app/api/
│   ├── components/             # UI y componentes de aplicación (ver src/components/README.md)
│   ├── contexts/               # AuthContext, ToastContext
│   ├── controllers/            # Contratos de controllers (documentación)
│   ├── lib/                    # Utilidades; lib/server/ = adaptadores BFF que llaman al backend
│   ├── services/               # Cliente HTTP (ver src/services/README.md)
│   ├── types/                  # Tipos del dominio
│   └── middleware.ts           # Guardia edge de rutas protegidas
├── tests/e2e/                  # Playwright (specs .live.* requieren el stack de QA)
└── scripts/check-env.mjs       # Guard de arranque: exige BACKEND_API_URL
```

**Flujo de una llamada:** el cliente (`services/api.ts`) llama
same-origin a `/api/*` → el Route Handler del BFF (`app/api/**`) valida la
sesión y llama al backend real vía `BACKEND_API_URL` (`src/lib/server/`) →
los tokens viajan solo en cookies `HttpOnly`, nunca al JavaScript del
navegador.

### Autenticación y autorización

- **Backend es la autoridad** en cada request; las cookies `HttpOnly`
  llevan los tokens (`lib/auth-cookies.ts`).
- `middleware.ts` es un guard **grueso** de borde: solo bloquea requests sin
  cookie de sesión plausible; no decodifica tokens.
- `ProtectedRoute` maneja redirecciones por rol del lado del cliente (UX),
  no es la frontera de seguridad.
- `GET /api/auth/session` hidrata la sesión con validación server-side.

### Modo mock (heredado, acotado)

Algunos Route Handlers siguen respaldados por datos mock (`src/mocks/`),
rastreados por pantalla y no por un flag global. `NEXT_PUBLIC_USE_MOCKS`
solo elige el header `x-mock-role` de esos handlers y **ya no** cambia la
URL que llama el cliente; la imagen de producción la fija en `"false"`
(`frontend/Dockerfile`).

## Rutas principales

| Ruta | Sección | Acceso |
|---|---|---|
| `/` | Landing pública | público |
| `/login`, `/forgot-password`, `/reset-password` | Autenticación | público |
| `/student/*` | Portal del alumno (enroll, dependientes, ficha médica, pagos, asistencia) | alumno/representante |
| `/trainer/*` | Panel del entrenador (tomar lista, historial) | entrenador |
| `/dashboard`, `/members`, `/payments`, `/groups`, `/attendance`, `/discounts`, `/reports`, `/ayuda`, `/profile`, `/admin/crear-cuenta` | Administración | admin (y roles según pantalla) |
| `/unauthorized` | Sin rol | — |

## Tests

```bash
pnpm test            # Vitest (unit + componentes)
pnpm exec playwright test        # E2E con API mockeada (page.route)
make qa-live         # (raíz) E2E reales .live.* contra el stack de QA
```

Los specs `*.live.spec.ts` atraviesan un backend real y quedan fuera de la
suite por defecto: `playwright.config.ts` solo declara el proyecto
`e2e-live` con `E2E_LIVE=1`.

## Configuración y documentación

- Variables de entorno: [`../docs/reference/configuration.md`](../docs/reference/configuration.md).
- Portal documental completo: [`../docs/README.md`](../docs/README.md).
- Guías por capa: `src/app/README.md`, `src/components/README.md`,
  `src/services/README.md`, `src/controllers/README.md`.
