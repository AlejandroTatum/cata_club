# `src/services/` — el cliente HTTP

Capa central de comunicación con el exterior. Tres archivos hoy —`api.ts`,
`auth.ts`, `categorias.ts`—, y la lista viva sale de `eza src/services`; la
versión anterior de este README nombraba uno solo.

## Reglas

- **Nada de UI acá.** Devuelven datos planos, nunca JSX.
- **Ningún `fetch()` fuera de este directorio.**
- **El manejo de errores vive acá**: envuelve `fetch` y devuelve errores
  tipados. Una pantalla no debería tener que interpretar un status HTTP.

## La convención de rutas

El cliente siempre llama a `apiEndpoint(recurso)`, que resuelve a `/api` +
recurso, **al mismo origen**: `"/payments"` → `/api/payments`.

No existe un modo «backend directo». Los tokens de acceso y refresco viven en
cookies HttpOnly, invisibles para el JavaScript del navegador, así que solo un
route handler del lado del servidor puede adjuntar `Authorization: Bearer` (ver
`src/lib/server/backend-client.ts`).

Cada route handler decide por su cuenta si ya proxea al backend real o todavía
sirve datos de mentira. `NEXT_PUBLIC_USE_MOCKS` solo controla la cabecera
`x-mock-role` que se manda a los que siguen siendo mocks — es un resto de la
etapa anterior, no el modo de trabajo. La cabecera refleja la sesión real y
vigente, no un rol elegido a mano (ver `contexts/AuthContext.tsx`).

## Dónde mirar primero

`api.ts` es largo y su comentario de cabecera explica el porqué de
`getBaseUrl`/`apiEndpoint`. Leelo antes de agregar una llamada: la mayoría de
las preguntas sobre por qué algo va al mismo origen están contestadas ahí.
