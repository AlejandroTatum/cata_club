# Inventario de orígenes de la CSP (issue #1069)

> **Estado: evidencia de fuente, no de runtime.** Todo lo que sigue se derivó
> de leer el código de este repositorio (base: `8fea18f`, worktree
> `pi-readiness-remaining`). No afirma cómo se comporta staging ni producción
> hoy, ni completa por sí solo los criterios del issue: el paso a modo
> estricto sigue bloqueado detrás del gate de la sección final.

## Dónde vive cada capa

- **Borde (la CSP que este inventario cubre):** el Caddyfile declara
  `Content-Security-Policy-Report-Only` (`Caddyfile:185`), con la justificación
  por directiva en sus comentarios (`Caddyfile:153-184`). La cabecera que
  bloquea está prohibida en esta fase por el test raíz
  `tests/test_docker_compose_config.py:960`.
- **Backend API:** CSP propia de una línea sin orígenes externos
  (`default-src 'none'; frame-ancestors 'none'`, `backend/main.py:339`) para
  sus respuestas JSON; no necesita inventario de terceros.

## Recolección de reportes (fase 1, activa)

`report-uri /api/csp-report` apunta al endpoint propio de la app
(`frontend/src/app/api/csp-report/route.ts`), no a un proveedor externo. El
endpoint: acepta `application/csp-report` y `application/reports+json`,
loguea cada violación con `console.warn` (línea 30) a los logs del contenedor
`frontend` y responde `204` sin auth ni bloqueo. Los reportes reales se leen
con `docker compose ... logs frontend`; hoy no hay ninguna agregación ni
persistencia más allá de esos logs.

## Resumen por directiva

| Directiva | Permitido hoy | Uso observado en el código | Veredicto |
|-----------|---------------|----------------------------|-----------|
| `script-src` | `'self' 'unsafe-inline'` | Next.js App Router inyecta scripts inline sin nonce (afirmación documentada en `Caddyfile:157-163`, verificada ahí compilando la app; este inventario no la re-verificó) | Necesario hoy; endurecer exige plomería de nonce que no existe |
| `style-src` | `'self' 'unsafe-inline'` | `style={{...}}` inline en varios archivos (p. ej. `StatCard.tsx`, `landing/HeroCarousel.tsx`; `Caddyfile:164-166`) | Igual que `script-src` |
| `img-src` | `'self'`, `https://res.cloudinary.com`, `https://*.tile.openstreetmap.org` | Fotos de perfil: `AppShell.tsx:887`, `profile/page.tsx:505`, `student/page.tsx:551`; logos de sponsors: `Sponsors.tsx:132`; tiles del mapa: `MapCanvas.tsx:32`; comprobantes-imagen: `payments/page.tsx:326` | Los tres orígenes son requeridos y cubiertos |
| `frame-src` | `https://api.cloudinary.com` | Los `<iframe>` reales (`payments/page.tsx:319,1776`) apuntan a `res.cloudinary.com` (voucher firmado `raw/authenticated`, `backend/app/infraestructura/cloudinary_cliente.py:209`) | **Desalineado:** `api.cloudinary.com` sin uso de navegador hallado; `res.cloudinary.com` requerido y no permitido (ver incógnita 1) |
| `connect-src` | `'self'` | Toda llamada del navegador va a Route Handlers same-origin (`frontend/src/services/api.ts:168`); no hay fetch a terceros | Correcto |
| `font-src` | `'self'` | Fuentes self-hosted con `next/font/local` (`frontend/src/app/page.tsx:2`, `frontend/src/lib/fonts.ts`) | Correcto |
| `frame-ancestors` | `'none'` | Sin embeds propios | Correcto |
| `base-uri` | `'self'` | Sin reescritura de base | Correcto |

## Orígenes externos que la CSP NO necesita

Son navegación (`<a href>`), no carga de recursos; ninguna directiva los
gobierna. Si aparecen en reportes, es como página de origen, no como recurso:

- `https://www.openstreetmap.org` — enlace «ver en OSM» (`club-location.ts:47`)
- `https://wa.me` — enlaces de WhatsApp (`landing-config.ts:53-54`)
- Facebook e Instagram — enlaces del landing (`LandingPage.tsx:401-402`)

No agregues estos orígenes a la CSP por verlos en un reporte.

## Incógnitas que la observación debe resolver

1. **Iframe de comprobantes PDF:** el código indica que cada vista previa PDF
   dispara una violación de `frame-src` (el contenido vive en
   `res.cloudinary.com`, solo permitido para `img-src`). Confirmar con
   reportes reales; la corrección sería permitir ese origen en `frame-src`,
   no ampliar nada más.
2. **Censo real de inline:** cuántos scripts/estilos inline aparecen por
   página en tráfico real, para decidir si el modo estricto requiere nonce o
   hashes.
3. **Orígenes en reportes sin uso en el código:** extensiones de navegador,
   proxies corporativos o inyección; clasificar caso por caso antes de
   permitir nada.

## Gate de enforcement (fase 2)

Antes de reemplazar la cabecera por la que bloquea:

- [ ] ≥ 1 semana de observación en staging con la política Report-Only
      activa y tráfico real.
- [ ] Evidencia: reportes de `/api/csp-report` (logs del contenedor
      `frontend`) clasificados origen por origen, con la incógnita 1
      resuelta con datos.
- [ ] Cero violaciones que apunten a orígenes requeridos ausentes de la
      política candidata.

Este documento registra fuentes y gate, no resultados: no se observó staging
ni producción para elaborarlo, y el conteo de reportes reales queda fuera de
este repositorio hasta corrida la ventana.

## Método (reproducir)

```bash
grep -rn "cloudinary\|openstreetmap\|wa.me\|fonts" frontend/src --include="*.tsx" --include="*.ts" | grep -v __tests__
grep -rn "https\?://" frontend/src --include="*.tsx" --include="*.ts" | grep -v __tests__ | grep -vE "localhost|example"
grep -n "raw/authenticated" backend/app/infraestructura/cloudinary_cliente.py
```
