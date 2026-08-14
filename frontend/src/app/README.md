# `src/app/` — páginas y route handlers

App Router de Next.js 14. Cada subdirectorio con un `page.tsx` es una ruta.

Este archivo **no lista las rutas**. La versión anterior lo hacía y nombraba
cinco cuando existían veinticuatro: una tabla que duplica lo que el árbol de
archivos ya dice envejece el día que alguien agrega una página. La lista viva
sale de un comando:

```bash
fd 'page.tsx' src/app          # las páginas
fd 'route.ts' src/app/api      # los route handlers
```

## La regla que sí hay que conocer: el patrón BFF

El navegador **nunca** habla con el backend de FastAPI. Toda llamada del cliente
va al mismo origen, a un route handler bajo `/api/*`, y ese handler —que corre
en el servidor— es el que alcanza el backend a través de `BACKEND_API_URL`
(ver `src/lib/server/`).

Esto no es una preferencia de estilo, es lo que sostiene la seguridad de la
sesión: **los tokens de acceso y refresco viven en cookies HttpOnly**, invisibles
para el JavaScript del navegador. Solo un handler del lado del servidor puede
adjuntar `Authorization: Bearer` (ver `src/lib/server/backend-client.ts`). Si
una página hiciera `fetch` directo al backend, no tendría con qué autenticarse
—y si lo tuviera, sería porque el token quedó expuesto.

`NEXT_PUBLIC_API_URL` **no se lee en ningún lado bajo `src/`** en tiempo de
ejecución: existe solo como build ARG del `Dockerfile`.

## Qué NO son los route handlers

No son stubs de desarrollo. La versión anterior de este archivo decía que se
usaban «exclusively for local development mocks», y hoy setenta y nueve
archivos bajo `src/app/api/` alcanzan el backend real.

Quedan restos de la etapa de mocks: `NEXT_PUBLIC_USE_MOCKS` sobrevive
únicamente para elegir la cabecera `x-mock-role` en los handlers que todavía no
migraron (ver el comentario de cabecera de `src/services/api.ts`). Es una
excepción en retirada, no el modo de trabajo.

## Convenciones

- Una página exporta `export default function`. Las veinticuatro lo hacen; es
  requisito de Next.js, no una elección del proyecto.
- La lógica de negocio no vive acá. Los datos se piden por `src/services/`, y
  el acceso al backend se resuelve en `src/lib/server/`.
- Lo visual lo gobierna [`DESIGN.md`](../../../DESIGN.md), no el criterio de
  cada página. Si una pantalla lo contradice, la pantalla está mal.
