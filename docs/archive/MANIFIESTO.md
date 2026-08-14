# Manifiesto de reorganización — docs/archive/

Fecha de la reorganización: **2026-08-13** · Rama: `docs/reorganize-documentation` · Base: `eace106`

Este manifiesto registra, para cada archivo movido a `docs/archive/`, su origen,
su commit/fecha de creación (cuando se conoce), su sensibilidad y los
delete-candidates detectados. **Git conserva los blobs**: mover o borrar
archivos del árbol de trabajo no reduce el historial del repositorio.

Los renames se hicieron con `git mv` (historia preservada). Los contenidos no
se reescribieron salvo los links/banners indicados en cada sección y la
redacción de un secreto documentada en la sección 2.

---

## 1. audits/2026-07-27/ — Auditoría de readiness + hallazgos post-presentación

| Archivo | Origen | Commit creación | Fecha |
|---|---|---|---|
| `auditoria-production-readiness.md` | `docs/auditoria-production-readiness-main-2026-07-27.md` | `a4db047` | 2026-07-28 |
| `hallazgos-post-presentacion.md` | `docs/hallazgos-post-presentacion.md` | `a4db047` | 2026-07-28 |

- El archivo de auditoría se renombró (se quitó el sufijo `-main-2026-07-27`:
  la fecha ya la da la carpeta).
- Ediciones de links: ninguna interna; el banner no apunta fuera.

## 2. audits/2026-08-10/ — Auditoría de producto + verificación QA

| Archivo | Origen | Commit creación | Fecha |
|---|---|---|---|
| `README.md` | `docs/auditoria-qa/README.md` | `3880d46` | 2026-08-11 |
| `verificacion-qa.md` | `docs/verificacion-qa-2026-08-10.md` | `3880d46` | 2026-08-11 |
| `img/` (14 PNG) | `docs/auditoria-qa/img/` | — | 2026-08-10 |

- El informe del 10-ago se detectó por contenido (el nombre `README.md` no
  llevaba fecha; el título dice «10 de agosto de 2026»).
- Links internos del informe a `img/…` son relativos y siguen válidos tras el
  movimiento en bloque.
- **Sensibilidad:** el informe contenía el `userToken` de Penpot en la última
  sección. En esta rama se redactó el árbol de trabajo: el valor real del query
  param quedó como `[REDACTED-REVOKE-TOKEN]`, preservando la URL y el contexto
  del informe. **La redacción no resuelve la exposición: el secreto permanece
  en el historial Git** (blobs previos de `docs/auditoria-qa/README.md` y de
  este archivo) y **DEBE revocarse/rotarse en Penpot**. El estado pasa a
  cerrado solo tras la revocación, no antes.

## 3. audits/2026-08-11/ — Re-verificación de auditoría

| Archivo | Origen | Commit creación | Fecha |
|---|---|---|---|
| `README.md` | `docs/auditoria-qa/README-2026-08-11.md` | `b629104` | 2026-08-12 |
| `img/` (35 PNG) | `docs/auditoria-qa/img-2026-08-11/` | — | 2026-08-11 |
| `raw/` (findings.jsonl, qa-explore.mjs) | `docs/auditoria-qa/raw-2026-08-11/` | — | 2026-08-11 |

- Links internos del informe a `img/…` son relativos y siguen válidos.
- `raw/qa-explore.mjs` contiene rutas `docs/auditoria-qa/img-2026-08-11` y
  `docs/auditoria-qa/raw-2026-08-11` escritas en el momento de la corrida: son
  parte del registro histórico y quedan intactas.

## 4. audits/2026-08-12/ — QA del registro de cuentas (inscripción)

| Archivo | Origen | Commit creación | Fecha |
|---|---|---|---|
| `README.md` | `docs/auditoria-qa/README-inscripcion-2026-08-12.md` | `7e1f29d` | 2026-08-12 |
| `img/` (82 PNG) | `docs/auditoria-qa/img-inscripcion-2026-08-12/` | — | 2026-08-12 |

- El informe se renombró (`README-inscripcion-2026-08-12.md` → `README.md`): el
  tema «inscripción» queda en el título interno y la fecha la da la carpeta.
- El informe menciona en texto la ruta `docs/auditoria-qa/img-inscripcion-2026-08-12/`
  (línea 48): referencia histórica intencional, no se editó.
- **Consumidor vivo:** `frontend/tests/e2e/enroll-qa.spec.ts` escribe capturas
  en `../docs/archive/audits/2026-08-12/img` — se actualizó el `SHOT_DIR` y los
  comentarios del spec en este PR. Correr esa suite vuelve a escribir capturas
  en la ubicación nueva.

## 5. fixes/ — Dossiers de la tanda de corrección (bloque completo)

| Grupo | Origen | Cantidad |
|---|---|---|
| Dossiers `01`–`24` | `docs/fixes/NN-*.md` | 24 md |
| Integraciones `00-INTEGRACION*.md` | `docs/fixes/00-INTEGRACION*.md` | 2 md |
| Subtotal dossiers + integraciones | — | 26 md |
| `BRIEF.md` | `docs/fixes/BRIEF.md` | 1 md |
| **Total de archivos md** | — | **27 md** |
| `img/` | `docs/fixes/img/` | 95 PNG |

- Commit de creación del bloque: `3880d46` (2026-08-11).
- Movido **en bloque** para preservar los paths relativos entre dossiers e
  imágenes (`img/…` desde cada dossier). No se editó ningún dossier.
- Referencias cruzadas entre dossiers escritas como `docs/fixes/…` (texto)
  quedan como estaban: son historia del proceso de integración.
- **Delete-candidates (duplicados exactos, no borrados en este PR):**

| Grupo hash | Archivos idénticos |
|---|---|
| `042ffbc…` | `img/22-columna-estado-390-pendientes-antes.png` = `…-despues.png` |
| `186e450…` | `img/09-asi6-historial-antes.png` = `…-despues.png` |
| `fcd2847…` | `img/15-ficha-propia-antes-movil.png` = `…-despues-movil.png` |

## 6. plans/ — Planes y pendientes superados

| Archivo | Origen | Commit creación | Fecha |
|---|---|---|---|
| `pendientes.md` | `docs/pendientes.md` | `bb1a70f` | 2026-08-05 |
| `pendientes-2026-08-11.md` | `docs/pendientes-2026-08-11.md` | `764242c` | 2026-08-11 |
| `plan-de-lanzamiento.md` | `docs/plan-de-lanzamiento.md` | `3880d46` | 2026-08-11 |

- Los tres llevan banner «HISTÓRICO — superado» apuntando a
  `operations/production-readiness.md`. Se actualizó la **ruta del link** del
  banner (`../../operations/production-readiness.md`) para que siga navegable;
  el resto del contenido no se tocó.
- `pendientes.md` referencia `docs/como-trabajamos.md` en dos lugares; se
  actualizó el link navegable a `../../reference/como-trabajamos.md` (el texto
  descriptivo `docs/como-trabajamos.md` se conserva).
- Menciones textuales a `docs/hallazgos-post-presentacion.md`,
  `docs/ux/objetivo-tactil.md` y `docs/pendientes.md` quedan como registro
  histórico.
- **Sensibilidad:** listas de pendientes sin datos personales; contienen
  referencias a commits y a hallazgos de seguridad (histórico, no se edita).

## 7. sessions/2026-08-11/ — Cierre de sesión

| Archivo | Origen | Commit creación | Fecha |
|---|---|---|---|
| `cierre-sesion.md` | `docs/cierre-sesion-2026-08-11.md` | `e863341` | 2026-08-11 |

- Se actualizó el link navegable a `decisiones-de-negocio-2026-08-11.md`
  (`../../../product/decisiones-de-negocio-2026-08-11.md`). Menciones textuales
  a `docs/auditoria-qa/README.md`, `docs/fixes/`, `docs/pendientes.md` quedan
  como registro histórico.

## 8. prototypes/ — Prototipos, evaluación y plan del rediseño

| Archivo | Origen | Commit creación | Fecha |
|---|---|---|---|
| `evaluacion-usabilidad-rediseno.md` | `docs/ux/evaluacion-usabilidad-rediseno.md` | `a5966ab` | 2026-07-23 |
| `plan-implementacion-rediseno.md` | `docs/ux/plan-implementacion-rediseno.md` | `a5966ab` | 2026-07-23 |
| `prototipo-rediseno.html` | `docs/ux/prototipo-rediseno.html` | (con `docs/ux/`) | 2026-07-23 |
| `prototipos/` (38 archivos) | `docs/ux/prototipos/` | (con `docs/ux/`) | 2026-07-23+ |
| `capturas/` (23 archivos) | `docs/ux/capturas/` | (con `docs/ux/`) | 2026-07-25 |

- Los prototipos HTML se enlazan entre sí por paths relativos (`index.html`,
  `_sistema.css`, `NN-*.html`): el movimiento en bloque los conserva.
- `plan-implementacion-rediseno.md` cita `docs/ux/prototipos/` y
  `docs/ux/prototipo-rediseno.html` en texto: referencias históricas
  intencionales (describen la estructura de esa fecha).
- **Consumidores vivos actualizados:** comentarios en
  `frontend/src/lib/format-utils.ts` y `frontend/tests/e2e/discounts.live.spec.ts`
  apuntaban a `docs/ux/plan-implementacion-rediseno.md` y
  `docs/ux/evaluacion-usabilidad-rediseno.md`; se actualizaron a
  `docs/archive/prototypes/…`.

---

## Retención

- **Auditorías y dossiers de fixes:** se conservan indefinidamente como
  evidencia; son inmutables (solo se agregan referencias desde documentos
  vivos).
- **Planes superados:** se conservan mientras su contenido pueda ser citado o
  contrastado; la lista viva de readiness es la única autoridad vigente.
- **Delete-candidates (duplicados exactos):** listados arriba, **no borrados en
  este PR**. Decisión de borrado: solo tras revisión humana y con confirmación
  de que la pareja sobreviviente está referenciada por su dossier.
- **Baja definitiva de un archivo de archive:** nunca «en caliente»; si se
  decide, debe hacerse en un PR aparte que cite este manifiesto y confirme que
  el contenido está cubierto por otro blob del historial.

## Cómo se verificó

- Inventario antes/después con `find` + `sha256sum`: 349 archivos antes; 351
  después = 349 originales (335 movidos + 14 que quedaron en su lugar) + 2
  nuevos (`README.md` y `MANIFIESTO.md` de `archive/`). Cero archivos perdidos.
- Todos los movimientos son `git mv` (estado `R` en `git status`).
- Link checker local sobre Markdown/HTML de `docs/` y referencias repo-wide:
  sin links nuevos rotos; referencias preexistentes y snapshots documentadas en
  las secciones 1–8.
