# Documentación — Cata Club

Portal de la documentación del proyecto. Este índice es el punto de entrada
único: dice qué documento manda sobre qué, qué es histórico y qué es
evidencia generada, y a dónde ir según el rol de quien llega.

> **Estado:** Activa
>
> **Responsable:** Documentación viva (asignación nominal pendiente — ver
> [`reference/ownership.md`](reference/ownership.md))
>
> **Audiencia:** desarrollo, operación, producto y QA del proyecto
>
> **Última verificación:** 2026-08-13 · **Verificado contra commit:** `eace106`
>
> **Revisión recomendada:** con cada cambio estructural de `docs/`

## Ruta rápida por audiencia

| Si sos… | Empezá por |
|---|---|
| Operador / quien despliega | [`operations/production-readiness.md`](operations/production-readiness.md) (lista viva), luego los runbooks de [`operations/`](operations/) |
| Desarrollador backend | [`../backend/README.md`](../backend/README.md) + [`reference/configuration.md`](reference/configuration.md) |
| Desarrollador frontend | [`../frontend/README.md`](../frontend/README.md) + [`reference/configuration.md`](reference/configuration.md) |
| Dueño de producto / QA | [`operations/production-readiness.md`](operations/production-readiness.md) y las auditorías de [`archive/audits/`](archive/audits/) |
| Nuevo en el repo | [`../README.md`](../README.md) para el arranque, este índice para orientarse |
| Quien decide privacidad/retención | [`security/privacy-retention.md`](security/privacy-retention.md) |
| Quien quiere el contrato de servicio | [`product/acuerdo-de-servicio.md`](product/acuerdo-de-servicio.md) |

## Tabla de autoridad

Una sola fuente por tema. Si dos documentos se contradicen, manda el de esta
tabla; el otro está desactualizado o es histórico.

| Tema | Documento que manda |
|---|---|
| Qué falta para producción (lista viva) | [`operations/production-readiness.md`](operations/production-readiness.md) |
| Variables de entorno por componente y entorno | [`reference/configuration.md`](reference/configuration.md) |
| Responsables por área y aprobaciones | [`reference/ownership.md`](reference/ownership.md) |
| Despliegue | [`operations/deployment.md`](operations/deployment.md) |
| Rollback | [`operations/rollback.md`](operations/rollback.md) |
| Backup / restore | [`operations/backup-restore.md`](operations/backup-restore.md) |
| Incidentes | [`operations/incident-response.md`](operations/incident-response.md) |
| Privacidad y retención de datos | [`security/privacy-retention.md`](security/privacy-retention.md) |
| Concepto, alcance y modelo de dominio | [`product/concepto-alcance-modelo.md`](product/concepto-alcance-modelo.md) |
| Decisiones de negocio (vigentes) | [`product/decisiones-de-negocio-2026-08-11.md`](product/decisiones-de-negocio-2026-08-11.md) |
| Contrato de servicio al club | [`product/acuerdo-de-servicio.md`](product/acuerdo-de-servicio.md) |
| Método de trabajo del equipo | [`reference/como-trabajamos.md`](reference/como-trabajamos.md) |
| Normas UX activas (táctil, escalas, ritmo) | [`ux/`](ux/) |
| Arquitectura y arranque del backend | [`../backend/README.md`](../backend/README.md) |
| Arquitectura y arranque del frontend | [`../frontend/README.md`](../frontend/README.md) |

## Estructura de `docs/`

La documentación se separa en tres clases — **activa**, **histórica** y
**evidencia** — y en dos zonas físicas: lo vigente en la raíz y lo superado en
[`archive/`](archive/README.md).

```
docs/
├── README.md                              # Este portal
├── product/                               # Activos de producto y dominio
│   ├── concepto-alcance-modelo.md / .pdf  #   Referencia del MVP (vigente)
│   ├── decisiones-de-negocio-2026-08-11.md#   Decisiones que gobiernan reglas
│   ├── acuerdo-de-servicio.md             #   Contrato con el club (vigente)
│   └── propuesta-de-servicio.md           #   Derivación del precio (USO INTERNO)
├── operations/                            # Operación (activa)
│   ├── production-readiness.md            #   ÚNICA lista viva de readiness
│   ├── deployment.md                      #   Runbook de despliegue
│   ├── rollback.md                        #   Runbook de rollback
│   ├── backup-restore.md                  #   Backup/restore (decisión pendiente)
│   └── incident-response.md               #   Proceso de incidentes
├── reference/                             # Referencia (activa)
│   ├── configuration.md                   #   Inventario de variables de entorno
│   ├── ownership.md                       #   Roles, responsables y aprobaciones
│   └── como-trabajamos.md                 #   Método de trabajo del equipo
├── security/                              # Seguridad y privacidad (activa)
│   └── privacy-retention.md               #   Clasificación y retención de datos
├── ux/                                    # Normas UX vigentes del sistema visual
│   ├── objetivo-tactil.md                 #   Objetivo táctil (WCAG 2.5.8 AA)
│   ├── escala-iconos.md                   #   Escala de iconos
│   ├── escala-tipografica.md              #   Escala tipográfica
│   ├── ritmo-vertical.md                  #   Ritmo vertical
│   └── candado-valores-arbitrarios.md     #   Candado de valores arbitrarios
└── archive/                               # Histórico y evidencia (no se actualiza)
    ├── README.md                          #   Política de archivo + navegación
    ├── MANIFIESTO.md                      #   Origen→destino, retención, delete-candidates
    ├── audits/YYYY-MM-DD/                 #   Auditorías y verificaciones fechadas
    │   ├── 2026-07-27/                    #     Readiness + hallazgos post-presentación
    │   ├── 2026-08-10/                    #     Auditoría de producto + verificación QA
    │   ├── 2026-08-11/                    #     Re-verificación de la auditoría
    │   └── 2026-08-12/                    #     QA de inscripción (81 casos)
    ├── fixes/                             #   Dossiers de fixes (24) + integraciones
    ├── plans/                             #   Pendientes y plan de lanzamiento (superados)
    ├── sessions/2026-08-11/               #   Cierre de sesión
    └── prototypes/                        #   Prototipos HTML, evaluación, capturas
```

## Tres clases de documento

1. **Activas** — describen el estado actual y se mantienen al día con el
   código. Únicas en su tema, con metadata de verificación al inicio. Si al
   verificarlas dejan de ser ciertas, se actualizan **en el mismo PR** que
   el cambio. Ejemplos: `operations/`, `reference/`, `security/`, `product/`,
   las normas de `ux/`, `backend/README.md`, `frontend/README.md`.
2. **Históricas** — capturan un momento y no se actualizan más. Viven en
   `archive/` con banner que dice qué son y dónde está la versión viva; su
   contenido no se reescribe. Ejemplos: `archive/plans/`,
   `archive/sessions/2026-08-11/`.
3. **Evidencia generada** — salidas de auditorías, capturas, dossiers de
   fixes, prototipos. Son inmutables y no se borran; viven en
   `archive/audits/`, `archive/fixes/`, `archive/prototypes/` y se
   referencian desde los documentos vivos. Git conserva los blobs: mover o
   borrar del árbol de trabajo no reduce el historial.

Regla de oro: **nunca se corrige el pasado en un documento histórico**; se
marca como histórico y la corrección vive en el documento activo.

## Detalle por área

- **`archive/audits/`** — un subdirectorio por fecha de auditoría, cada uno
  con su informe y su evidencia adyacente (capturas y raw). Navegación y
  política: [`archive/README.md`](archive/README.md).
- **`archive/fixes/`** — 24 dossiers (`01`–`24`) + 2 integraciones (`00-*`) de
  la tanda de corrección posterior a la auditoría del 10-ago, con sus
  imágenes before/after. La especificación de cada fix fue
  `archive/audits/2026-08-10/README.md` y las decisiones que los gobiernan,
  `product/decisiones-de-negocio-2026-08-11.md`.
- **`archive/prototypes/`** — prototipos HTML del rediseño («La Paleta»),
  su evaluación de usabilidad, el plan de implementación y las capturas del
  diseño aprobado.
- **`ux/`** — solo las normas del sistema visual que siguen rigiendo el
  código actual. Los documentos de proceso del rediseño están en
  `archive/prototypes/`.
