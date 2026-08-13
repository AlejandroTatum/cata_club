# Ownership: roles, responsables y aprobaciones

No hay un equipo formal con personas asignadas: esta matriz define **roles**
y qué le toca a cada uno. La **asignación nominal está pendiente** para
todas las áreas — por eso no existe `CODEOWNERS` y no se agrega en este PR
(sin dueño nominal, un `CODEOWNERS` sería ficción). Cuando se asigne una
persona por área, se actualiza esta tabla y recién entonces tiene sentido
crear el `CODEOWNERS`.

> **Estado:** Activa (roles definidos; asignación nominal pendiente)
>
> **Responsable:** Coordinación del proyecto (asignación nominal pendiente)
>
> **Audiencia:** todo el equipo y quienes revisan PRs
>
> **Última verificación:** 2026-08-13 · **Verificado contra commit:** `fd9f7be`
>
> **Revisión recomendada:** al asignar el primer dueño nominal, y con cada cambio de área

## Roles

| Rol | Alcance | Responsabilidades típicas |
|---|---|---|
| **Desarrollo backend** | `backend/`, `tests/`, `alembic/` | API, dominio, migraciones, rate limiting, configuración (`Settings`) |
| **Desarrollo frontend** | `frontend/` | BFF, UI, auth de sesión, tests unitarios y E2E |
| **Infraestructura / operación** | `docker-compose*.yml`, `Caddyfile`, `.github/workflows/ci.yml`, `Makefile` | Despliegue, rollback, backups, monitoreo, incidentes |
| **Seguridad** | transversal | Claves, cookies, headers, superficie de ataque, privacidad |
| **Producto / dominio** | decisiones de negocio | Reglas de negocio, prioridades, criterios de aceptación |
| **QA / evidencia** | `docs/auditoria-qa/`, `docs/fixes/` | Auditorías, verificación, capturas, trazabilidad |
| **Documentación viva** | `docs/` (activas), READMEs | Verdad documental, lista viva, runbooks, inventarios |
| **Privacidad / datos** | transversal | Clasificación, retención, borrado, tratamiento de menores |

## Matriz de propiedad por área

| Área | Rol dueño | Nominal | Aprobación requerida para cambios | Notas |
|---|---|---|---|---|
| Migraciones de esquema | Desarrollo backend | pendiente | Revisión backend + CI (`migraciones-desde-cero`) | Entrypoint fail-fast: una migración rota impide el arranque |
| Seguridad | Seguridad + Desarrollo | pendiente | Revisión de seguridad (o coordinación si no existe) | Tokens, cookies HttpOnly, headers, rate limiting |
| Infraestructura / despliegue | Infraestructura | pendiente | Infraestructura + Desarrollo | Compose prod, Caddyfile, CI de imágenes |
| Dominio / producto | Producto | pendiente | Producto | Reglas de negocio, decisiones de alcance |
| Privacidad / retención | Privacidad / datos | pendiente | Producto + Seguridad | Ver [`../security/privacy-retention.md`](../security/privacy-retention.md) |
| Documentación viva | Documentación viva | pendiente | Dueño del área documentada | Lista viva, runbooks, inventarios |
| QA / evidencia | QA | pendiente | QA | Evidencia generada: inmutable, no se borra ni se mueve |
| Backend (código) | Desarrollo backend | pendiente | Revisión backend | |
| Frontend (código) | Desarrollo frontend | pendiente | Revisión frontend | |

## Matriz de aprobaciones por tipo de cambio

| Tipo de cambio | Debe aprobar | Regla vigente hoy |
|---|---|---|
| Cualquier commit / PR | Revisión técnica (PR) + CI verde | Todo va por PR a `main` (ver [`../CLAUDE.md`](../../CLAUDE.md)) |
| Cambio de esquema (migración) | Desarrollo backend | CI `migraciones-desde-cero` + revisión |
| Cambio de Compose prod / Caddyfile | Infraestructura | `make test-compose` + revisión del layering |
| Cambio de secretos o configuración de producción | Seguridad + Infraestructura | Fail-fast del backend como candado |
| Documentos activos (lista viva, runbooks) | Dueño del área + Documentación viva | Actualización en el mismo PR que el cambio que describen |
| Evidencia histórica (auditorías, capturas, fixes) | — | **No se edita ni se mueve**; solo se referencia |
| Decisión de backup / monitoreo / retención | Producto + Infraestructura | Decisiones abiertas en la lista viva |

## Cómo asignar nominalmente

1. Proponer una persona por área en esta tabla (columna «Nominal»).
2. Actualizar la lista viva
   ([`operations/production-readiness.md`](../operations/production-readiness.md))
   si la asignación resuelve una decisión pendiente.
3. Recién con dueños nominales estables: crear `CODEOWNERS` por
   directorio/área y mantenerlo con esta matriz.
