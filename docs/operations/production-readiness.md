# Readiness de producción — lista viva

**ÚNICA lista viva de preparación para producción.** Reemplaza a
`docs/archive/plans/pendientes-2026-08-11.md` y a `docs/archive/plans/plan-de-lanzamiento.md` como
fuente de verdad sobre qué falta para producir: esos dos son históricos y
pueden contener afirmaciones que ya no son ciertas. Si un ítem de acá no
reproduce contra el código actual, se actualiza este documento — no los
históricos.

> **Estado:** Activa
>
> **Responsable:** Infraestructura + Desarrollo (asignación nominal pendiente — ver
> [`../reference/ownership.md`](../reference/ownership.md))
>
> **Audiencia:** operación, desarrollo y producto
>
> **Última verificación:** 2026-08-13 · **Verificado contra commit:** `fd9f7be`
>
> **Revisión recomendada:** con cada cambio de Compose/CI/Makefile y antes de cada despliegue

## Cómo se mantiene esta lista

- Un ítem resuelto se **borra** de la lista; no se tacha. Un documento que
  acumula tachados vuelve a ser histórico.
- Cada ítem lleva su **evidencia verificable**: un comando, un archivo o un
  informe. Si la evidencia no reproduce, el ítem cambió y se actualiza acá,
  en el mismo PR que el código.
- La base de verificación es `origin/main`. El encabezado de este documento
  declara el commit contra el que se verificó; si el `HEAD` de `origin/main`
  es otro, todo lo de abajo es hipótesis hasta re-derivarlo
  (`git fetch origin && git rev-parse origin/main`).

## Estados

| Estado | Significado |
|---|---|
| **Ready** | Implementado y verificado; la evidencia está en el repo o se reproduce con un comando. |
| **Needs evidence** | El mecanismo existe, pero no hay evidencia de que se haya ejecutado/probado en el entorno real. |
| **Blocked** | Hallazgo verificado que impide abrir producción tal como está hoy. |
| **Not evaluated** | No hay mecanismo, ni evidencia, ni decisión tomada. |

## Matriz de capacidades operativas

Verificada el 2026-08-13 contra `fd9f7be`. Las rutas son relativas a la raíz
del repo.

| Capacidad | Estado | Owner | Evidencia verificable | Notas |
|---|---|---|---|---|
| CI: tests, lint, typecheck, compose layering, migraciones desde cero | Ready | Desarrollo | `.github/workflows/ci.yml` (jobs `backend`, `migraciones-desde-cero`, `frontend`) | El gate corre en cada PR. Estado de la última corrida: GitHub Actions. |
| Imágenes publicadas en GHCR por SHA inmutable | Ready | Infraestructura | `.github/workflows/ci.yml`, job `docker-images` (`IMAGE_TAG=${{ github.sha }}`) | `latest` se publica además, pero **no** es la recomendación de despliegue: fijar por SHA. |
| Stack productivo definido y validado en CI | Ready | Infraestructura | `docker-compose.prod.yml` + `docker-compose.yml` + `tests/test_docker_compose_config.py` | CI arranca el stack con los `-f` explícitos y espera healthchecks antes de publicar. |
| Ingress TLS (Caddy + Let's Encrypt) | Ready | Infraestructura | `docker-compose.prod.yml` (servicio `caddy`, `caddy_data`/`caddy_config`) y `Caddyfile` | Único servicio con puertos publicados (80/443). Certificados en named volumes. El `Caddyfile` está versionado; automatizar/registrar `caddy validate` en CI queda pendiente. |
| Límites de memoria y rotación de logs por servicio | Ready | Infraestructura | `docker-compose.prod.yml` (`mem_limit` y `logging: json-file, 10m × 3` en los 7 servicios) | Presupuesto documentado: 1536m de 2048m, logs ≤ 210 MB totales. |
| Migraciones automáticas en arranque, fail-fast | Ready | Backend | `backend/scripts/entrypoint.sh` (`set -eu`; aborta si `alembic upgrade head` falla) | Mismo patrón verificado por el job `migraciones-desde-cero` de CI. |
| Sondas de salud y readiness | Ready | Backend | `backend/main.py` (`/health`, `/health/ready` con Postgres+Redis) y healthchecks de `docker-compose.yml` | `/health` sin dependencias; `/health/ready` devuelve 503 si una dependencia cae. |
| Cabeceras de seguridad en borde y API | Ready | Backend + Infraestructura | `Caddyfile` (HSTS, nosniff, DENY, referrer) y `backend/main.py` (`_CabecerasDeSeguridadMiddleware`) | CSP de la API (`default-src 'none'`); CSP del sitio pendiente por decisión (ver `Caddyfile`). |
| Correlación de requests (`X-Request-ID`) | Ready | Backend | `backend/main.py`, `_CorrelacionDeRequestMiddleware` | Presente en toda respuesta, expuesta a CORS. |
| Circuit breakers de dependencias externas | Ready | Backend | `backend/main.py` (`/diagnostico/circuitos`, rol ADMINISTRADOR) + `app/soporte_transversal/circuito_breaker.py` | Cubre Cloudinary/SMTP; resumen admin en `/diagnostico/circuitos`. |
| Despliegue real en entorno de producción | Needs evidence | Infraestructura (nominal pendiente) | Runbook [`deployment.md`](deployment.md) (creado en este PR) | El mecanismo está verificado; **no hay en el repo evidencia de un despliegue ejecutado** contra un entorno real. Ejecutar y registrar. |
| Rollback a imagen previa | Needs evidence | Infraestructura (nominal pendiente) | Runbook [`rollback.md`](rollback.md) | Mecanismo Ready (SHA inmutables); no hay evidencia de un rollback ejecutado. |
| Backup y restore de Postgres | Not evaluated | Infraestructura (nominal pendiente) | [`backup-restore.md`](backup-restore.md) | **No existe mecanismo de backup automatizado ni restore probado.** Decisión pendiente; ver runbook. Crítico por datos de menores y pagos. |
| Monitoring: métricas y trazas | Blocked | Infraestructura (nominal pendiente) | `rg -ln "prometheus|opentelemetry|statsd" backend/ frontend/src` → vacío | Solo existe correlación (`X-Request-ID`). El plan de lanzamiento lo trató como bloqueante: sin métricas, una caída se descubre porque avisa un socio. |
| Rate limiting de tráfico anónimo | Blocked | Backend | `backend/app/soporte_transversal/rate_limit.py` + informe de inscripción (`docs/archive/audits/2026-08-12/README.md`, sección "Límite de intentos") | El cubo es global para tráfico anónimo: en la topología de producción (BFF server-side) **todos los visitantes comparten un cubo** — 11 pedidos/min dejan el club sin poder inscribir. Fix en rama local sin mergear (`fix/rate-limit-por-visitante`); no re-implementar, revisar y mergear. |
| Inventario de variables de entorno | Ready (con gap) | Desarrollo | [`reference/configuration.md`](../reference/configuration.md) + ver ítem A-2 abajo | Este PR crea el inventario canónico; los `.env.example` siguen sin documentar `IMAGE_TAG`, `FRONTEND_URL` y los `SMTP_*` (ítem A-2). |

## Hallazgos abiertos

Solo hallazgos verificables y vigentes, con su evidencia. Para el detalle
completo: [`docs/archive/audits/2026-08-12/README.md`](../archive/audits/2026-08-12/README.md)
(auditoría de inscripción del 12-ago), los históricos referenciados al pie y
los `docs/archive/fixes/`.

### De la auditoría de inscripción (12-ago-2026)

Veredicto del informe: **no hay bloqueantes ni hallazgos de integridad de
datos** — el backend ataja todo lo que el formulario deja pasar. Son
defectos de experiencia, agrupados en cuatro causas raíz. La verificación
contra el backend real está en el informe (la suite congela "hoy" en
2029-01-01, detalle en `backend/tests/conftest.py`).

| ID | Causa raíz | Impacto | Estado |
|---|---|---|---|
| G01–G04, G08 | **A** — el formulario público no aplica las cotas de edad del alumno (`5 ≤ edad ≤ 74`) ni rechaza fechas futuras | Fecha futura y edades fuera de rango avanzan el asistente; el backend rechaza al final (UX, no integridad) | Abierto — los asistentes hermanos ya lo validan (`add-dependent-utils.ts`, `crear-cuenta-utils.ts`) |
| G05 | **B** — `maxLength` recorta la cédula en el input en lugar de validar | El 11º dígito se descarta en silencio; el visitante se inscribe con una cédula que no escribió | Abierto |
| G06 | **C** — credenciales opcionales a medio llenar: regla de paso, no de campo | Botón «Siguiente» habilitado; falla al clickear (única inconsistencia del modelo) | Abierto |
| M01–M02 | **D** — el mismo error se emite por toast y alerta; el toast tapa los botones «Corregir» | Mensaje duplicado y control tapado en el resumen | Abierto |
| — | **Rate limit global** (el hallazgo más serio del informe, infraestructura) | 11 pedidos/min agotan el cubo de TODO el sitio | **Blocked** — ver matriz. Fix en rama local sin mergear. |

### Del rastro de auditorías previas (re-verificados contra `fd9f7be`)

| ID | Ítem | Verificación hoy | Estado |
|---|---|---|---|
| A-1 | Sin métricas ni trazas | `rg -ln "prometheus|opentelemetry|statsd" backend/ frontend/src` → vacío | **Blocked** — ver matriz |
| A-2 | `.env.example` incompletos: el raíz no documenta `IMAGE_TAG`, `FRONTEND_URL` ni los `SMTP_*`; `RESET_HOSTS_PERMITIDOS` y `TEST_DATABASE_URL` no figuran en ninguno | Lectura de `.env.example`, `backend/.env.example`, `frontend/.env.local.example` | Abierto (documental) — mitigado por [`reference/configuration.md`](../reference/configuration.md); los examples aún no se actualizaron |
| A-3 | El 422 de Pydantic llega como arreglo en inglés | `rg -n "RequestValidationError" backend/` → sin handler global | Abierto (backend) — el BFF traduce algunos casos (ver S05 del informe de inscripción) |
| A-4 | `Asistencia` no guarda quién tomó la lista (`registrado_por`) | `rg -n "registrado_por" backend/app/dominio/modelos.py` → ausente | Abierto (trazabilidad) |
| A-5 | Quinto cálculo de edad sin unificar | `frontend/src/app/student/student-utils.ts` (`isMinor`) | Abierto (refactor) — los techos de `admin_cuenta_servicio.py` ya están resueltos (verificado) |
| A-6 | Capturas del fix 23 faltantes | `docs/archive/fixes/img/23*` no existe | Abierto (evidencia visual) |
| A-7 | Comprobantes legacy con URL pública en Cloudinary | No verificable sin credenciales reales | Abierto — requiere credenciales y migración de datos; ver `docs/archive/fixes/16-voucher-no-enumerable.md` |
| A-8 | Correo no ejercitable en QA (workers fuera de `QA_SERVICIOS`) | `Makefile` (`QA_SERVICIOS = db redis mailpit backend frontend`) | Abierto (señalizado en la salida de `make qa-up`) — en producción los workers sí están |

### Ítems del rastro previo que **ya no aplican** (no copiar de los históricos)

- `docker-compose.prod.yml` sin TLS / sin `mem_limit` / sin rotación de logs:
  **resuelto** — todo existe (verificado en el archivo y por
  `tests/test_docker_compose_config.py`).
- "134 commits sin publicar": el estado de publicación es de ese día; no es
  un ítem de readiness vigente.
- Ranking/nivel: **removido** del backend (`#165`, migración
  `7e8032f48249_remover_ranking_y_nivel_ranking.py`) — no es un pendiente.

## Decisiones pendientes que bloquean o condicionan

| Decisión | Por qué importa | Dónde se resuelve |
|---|---|---|
| Backup/RPO/RTO de Postgres y proveedor de almacenamiento | Sin backup no hay forma de recuperar datos de menores y pagos | [`backup-restore.md`](backup-restore.md) |
| Monitoring y alerting (qué medir, a dónde llegan los avisos) | Sin alertas, las caídas se descubren por avisos externos | [`incident-response.md`](incident-response.md) |
| Asignación nominal de owners (hoy solo roles) | Sin persona asignada no hay responsable real de ejecutar runbooks | [`reference/ownership.md`](../reference/ownership.md) |
| Política de retención y borrado de datos personales | Datos de menores y salud sin política de ciclo de vida | [`security/privacy-retention.md`](../security/privacy-retention.md) |

## Dónde está el resto

| Tema | Lugar |
|---|---|
| Detalle de hallazgos de inscripción y evidencia | [`docs/archive/audits/2026-08-12/README.md`](../archive/audits/2026-08-12/README.md) |
| Auditoría de producto (10-ago) | [`docs/archive/audits/2026-08-10/README.md`](../archive/audits/2026-08-10/README.md) |
| Auditoría de readiness (27-jul) | [`docs/archive/audits/2026-07-27/auditoria-production-readiness.md`](../archive/audits/2026-07-27/auditoria-production-readiness.md) |
| Arreglos verificados: 24 dossiers (`01`–`24`) + 2 integraciones (`00-*`) | [`docs/archive/fixes/`](../archive/fixes/BRIEF.md) |
| Histórico de pendientes (8-ago, superado) | [`docs/archive/plans/pendientes.md`](../archive/plans/pendientes.md) |
| Histórico de pendientes (11-ago, superado) | [`docs/archive/plans/pendientes-2026-08-11.md`](../archive/plans/pendientes-2026-08-11.md) |
| Plan de lanzamiento (10-ago, superado) | [`docs/archive/plans/plan-de-lanzamiento.md`](../archive/plans/plan-de-lanzamiento.md) |
| Método de trabajo | [`reference/como-trabajamos.md`](../reference/como-trabajamos.md) |
