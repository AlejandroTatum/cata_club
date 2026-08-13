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
> **Última verificación:** 2026-08-13 · **Verificado contra commit:** `fd9f7be`
>
> **Revisión recomendada:** con cada cambio estructural de `docs/`

## Ruta rápida por audiencia

| Si sos… | Empezá por |
|---|---|
| Operador / quien despliega | [`operations/production-readiness.md`](operations/production-readiness.md) (lista viva), luego los runbooks de [`operations/`](operations/) |
| Desarrollador backend | [`../backend/README.md`](../backend/README.md) + [`reference/configuration.md`](reference/configuration.md) |
| Desarrollador frontend | [`../frontend/README.md`](../frontend/README.md) + [`reference/configuration.md`](reference/configuration.md) |
| Dueño de producto / QA | [`operations/production-readiness.md`](operations/production-readiness.md) y las auditorías de [`auditoria-qa/`](auditoria-qa/README.md) |
| Nuevo en el repo | [`../README.md`](../README.md) para el arranque, este índice para orientarse |
| Quien decide privacidad/retención | [`security/privacy-retention.md`](security/privacy-retention.md) |

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
| Arquitectura y arranque del backend | [`../backend/README.md`](../backend/README.md) |
| Arquitectura y arranque del frontend | [`../frontend/README.md`](../frontend/README.md) |
| Método de trabajo del equipo | [`como-trabajamos.md`](como-trabajamos.md) |

## Tres clases de documento

La confusión histórica de `docs/` venía de mezclar estas tres clases. La
regla:

1. **Activas** — describen el estado actual y se mantienen al día con el
   código. Únicas en su tema, con metadata de verificación al inicio. Si al
   verificarlas dejan de ser ciertas, se actualizan **en el mismo PR** que
   el cambio. Ejemplos: `operations/`, `reference/`, `security/`,
   `backend/README.md`, `frontend/README.md`.
2. **Históricas** — capturan un momento y no se actualizan más. Se les pone
   un banner que diga que son históricas y dónde vive la versión viva; su
   contenido no se reescribe. Ejemplos: `pendientes.md`,
   `pendientes-2026-08-11.md`, `plan-de-lanzamiento.md`,
   `cierre-sesion-2026-08-11.md`, `decisiones-de-negocio-2026-08-11.md`,
   `verificacion-qa-2026-08-10.md`, `hallazgos-post-presentacion.md`.
3. **Evidencia generada** — salidas de auditorías, capturas, runbooks de
   hechos pasados. Son inmutables y **no se borran ni se mueven**; se
   referencian desde donde se las usa. Ejemplos: `auditoria-qa/` (informes y
   capturas), `fixes/` (uno por arreglo, con imágenes), `ux/prototipos/`,
   `auditoria-production-readiness-main-2026-07-27.md`.

Regla de oro: **nunca se corrige el pasado en un documento histórico**; se
marca como histórico y la corrección vive en el documento activo.

## Reorganización física (estado transitorio)

La estructura de carpetas actual de `docs/` es transitoria: esta entrega
corrige la verdad documental y crea los fundamentos operativos **sin mover
nada todavía**. El target durable es reorganizar físicamente los archivos
(separar normativa, historia y evidencia en su lugar definitivo) **sin
cambiar su contenido**.

Mientras tanto: los históricos siguen donde están, con banner, y la evidencia
generada queda intacta; el índice se actualiza cuando la reorganización ocurra.

## Índice de `docs/`

```
docs/
├── README.md                              # Este portal
├── como-trabajamos.md                     # Método de trabajo (activo)
├── operations/                            # Operación (activa)
│   ├── production-readiness.md            #   ÚNICA lista viva de readiness
│   ├── deployment.md                      #   Runbook de despliegue
│   ├── rollback.md                        #   Runbook de rollback
│   ├── backup-restore.md                  #   Backup/restore (decisión pendiente)
│   └── incident-response.md               #   Proceso de incidentes
├── reference/                             # Referencia (activa)
│   ├── configuration.md                   #   Inventario de variables de entorno
│   └── ownership.md                       #   Roles, responsables y aprobaciones
├── security/                              # Seguridad y privacidad (activa)
│   └── privacy-retention.md               #   Clasificación y retención de datos
├── auditoria-qa/                          # Evidencia: informes y capturas de QA
├── auditoria-production-readiness-main-2026-07-27.md   # Evidencia: auditoría histórica
├── fixes/                                 # Evidencia: 24 dossiers (01-24) + 2 integraciones (00-*)
├── ux/                                    # Evidencia: prototipos y diseño
├── pendientes.md                          # HISTÓRICO (ver production-readiness.md)
├── pendientes-2026-08-11.md               # HISTÓRICO (ver production-readiness.md)
├── plan-de-lanzamiento.md                 # HISTÓRICO (ver production-readiness.md)
├── cierre-sesion-2026-08-11.md            # Histórico: cierre de sesión
├── decisiones-de-negocio-2026-08-11.md    # Histórico: decisiones tomadas
├── verificacion-qa-2026-08-10.md          # Histórico: verificación QA
├── hallazgos-post-presentacion.md         # Histórico: hallazgos post-presentación
├── concepto-alcance-modelo.md / .pdf      # Histórico: alcance del proyecto
└── propuesta-de-servicio.md               # Histórico: propuesta de servicio
```
