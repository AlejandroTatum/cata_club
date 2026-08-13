# Proceso de respuesta a incidentes

Qué hay implementado hoy para detectar y contener fallas, y qué proceso
seguir mientras no exista monitoreo proactivo. **No hay evidencia de un
incidente real gestionado con este proceso**: es el marco operativo, no un
registro.

> **Estado:** Activa (marco operativo)
>
> **Responsable:** Infraestructura (asignación nominal pendiente — ver
> [`../reference/ownership.md`](../reference/ownership.md))
>
> **Audiencia:** operador, desarrollo y QA
>
> **Última verificación:** 2026-08-13 · **Verificado contra commit:** `fd9f7be`
>
> **Revisión recomendada:** tras el primer incidente real y con cada cambio de monitoreo

## Capacidades existentes (verificadas)

| Capacidad | Cómo se manifiesta | Evidencia |
|---|---|---|
| Healthchecks por servicio | `docker compose ps -a` muestra `healthy`/`unhealthy`; Compose reinicia servicios con `restart: unless-stopped` | `docker-compose.yml` (db, redis, backend, celery-worker, celery-beat, frontend), `docker-compose.prod.yml` (caddy) |
| Sondas de la API | `/health` (liveness) y `/health/ready` (Postgres+Redis, 503 si una cae) | `backend/main.py` |
| Correlación de requests | `X-Request-ID` en toda respuesta y en los logs de error | `backend/main.py` |
| Circuit breakers | Cloudinary/SMTP degradan acotado; resumen en `/diagnostico/circuitos` (admin) | `backend/app/soporte_transversal/circuito_breaker.py` |
| Logs con rotación | `json-file`, `10m × 3` por servicio (máx. ~210 MB totales) | `docker-compose.prod.yml` |
| Fail-fast de migraciones | Si `alembic upgrade head` falla, el backend no arranca | `backend/scripts/entrypoint.sh` |

## Lo que NO existe (decisión pendiente)

- **Monitoreo/métricas proactivas y alertas**: hoy nadie recibe un aviso si
  el sitio cae; un incidente se descubre porque lo reporta un socio
  (verificado: sin `prometheus|opentelemetry|statsd` en el repo). Bloquea
  readiness — ver [`production-readiness.md`](production-readiness.md).
- On-call / escalamiento nominal (ver
  [`../reference/ownership.md`](../reference/ownership.md)).

## Proceso (propuesto)

### 1. Detección

- Señal pasiva: informe de un socio, healthcheck en rojo, `ps -a` con
  `unhealthy`/`restarting`.
- Comandos de diagnóstico inicial:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps -a
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs --no-color --tail=200 <servicio>
# Sonda de readiness por dentro del contenedor (prod no publica 8000; sin curl en la imagen)
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T backend \
  python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/health/ready', timeout=5).read().decode())"
```

### 2. Triage (10 min)

| Síntoma | Hipótesis típicas | Acción inmediata |
|---|---|---|
| `backend` en crash-loop | Config de producción incompleta (fail-fast), migración rota, Postgres sin espacio | Revisar logs; corregir env o hacer rollback |
| `frontend` unhealthy | Backend caído (502 vía Caddy), imagen rota | Ver dependencia; rollback si es la imagen |
| `/health/ready` 503 | Postgres o Redis caídos (disco lleno, OOM) | `df -h` en el host; reiniciar servicio |
| Sitio inalcanzable | Caddy caído (certificado, OOM) | Verificar 80/443 y `caddy_data` |

### 3. Comunicación

- Avisar al dueño del producto y al responsable de operaciones (roles en
  [`../reference/ownership.md`](../reference/ownership.md)); asignación
  nominal pendiente.
- Estado al usuario si la falla es visible: el sitio debe poder decirlo por
  sí mismo (decisión de monitoreo pendiente).

### 4. Contención y remediación

- **Rollback** de una imagen defectuosa:
  [`rollback.md`](rollback.md) (nunca `latest`).
- **Restart puntual** de un servicio colgado:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml restart <servicio>
```

- **Re-despliegue** de una configuración corregida:
  [`deployment.md`](deployment.md).

### 5. Postmortem

Documentar en un archivo nuevo bajo `docs/` (evidencia generada, no se
edita) con esta plantilla mínima:

```markdown
# Postmortem — <fecha> <descripción breve>

## Resumen
## Línea de tiempo (UTC)
## Causa raíz
## Impacto (duración, usuarios afectados, datos)
## Qué se hizo bien
## Qué falló
## Acciones correctivas (cada una con su candado/test)
## Evidencia (logs con request_id, capturas, SHAs involucrados)
```

Y actualizar la lista viva
([`production-readiness.md`](production-readiness.md)) si el incidente
descubre un hallazgo.

## Escalamiento

Hoy el escalamiento es por rol y el dueño nominal está pendiente
([`../reference/ownership.md`](../reference/ownership.md)). Cuando exista
monitoreo, definir también el canal de alertas y al dueño del canal.
