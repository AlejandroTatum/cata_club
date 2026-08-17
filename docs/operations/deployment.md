# Runbook de despliegue

Procedimiento para desplegar el stack de producción de Cata Club con las
interfaces reales del repo: imágenes publicadas en GHCR por el CI, Compose
de producción y Makefile. **Este runbook es la especificación, no un
registro: aún no hay evidencia de un despliegue ejecutado contra un entorno
real.** Ejecutarlo una vez y registrar el resultado en la lista viva
([`production-readiness.md`](production-readiness.md)).

> **Estado:** Activa (no probada en entorno real)
>
> **Responsable:** Infraestructura (asignación nominal pendiente — ver
> [`../reference/ownership.md`](../reference/ownership.md))
>
> **Audiencia:** operador con acceso al host de producción
>
> **Última verificación:** 2026-08-13 · **Verificado contra commit:** `fd9f7be`
>
> **Revisión recomendada:** con cada cambio de `docker-compose.prod.yml`, `Caddyfile` o CI

## Modelo de despliegue (cómo llega el código a producción)

1. `push` a `main` dispara el job `docker-images` de
   `.github/workflows/ci.yml`.
2. Ese job construye las dos imágenes, **arranca el stack productivo** con
   `-f docker-compose.yml -f docker-compose.prod.yml`, espera healthchecks y
   recién entonces publica en GHCR:
   `ghcr.io/alejandrotatum/cata_club-backend:<sha>` y
   `ghcr.io/alejandrotatum/cata_club-frontend:<sha>`.
3. En el host de producción se consume esa imagen **por SHA inmutable** — no
   por `latest`. El tag `latest` existe solo como default de Compose
   (`${IMAGE_TAG:-latest}`) y **no** es la recomendación de producción.

## Precondiciones

- `docker` y `docker compose` instalados en el host; acceso al registro GHCR
  (`docker login ghcr.io` o `docker pull` autenticado).
- Variables obligatorias del entorno de producción exportadas. El propio
  compose las exige con `:?` y el backend las valida con fail-fast
  (`AMBIENTE=production` activa `_exigir_config_de_produccion` en
  `backend/app/soporte_transversal/configuracion.py`):

  | Variable | Exigida por | Para qué |
  |---|---|---|
  | `JWT_SECRET_KEY` | compose (`:?`) + backend (siempre) | firma de tokens; `openssl rand -hex 32` |
  | `CORS_ORIGENES` | compose prod (`:?`) + backend | origen real del frontend |
  | `DOMINIO` | compose prod (`:?`) | certificado TLS y host del ingress |
  | `ACME_EMAIL` | compose prod (`:?`) | avisos de Let's Encrypt |
  | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_STARTTLS` | backend (fail-fast: host no catcher) | correo transaccional |
  | `FRONTEND_URL` | backend (fail-fast: absoluta https, no loopback) | enlaces en correos |
  | `POSTGRES_USER`, `POSTGRES_PASSWORD` | backend (fail-fast: no `usuario`/`password`) | credenciales de la base |
  | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | backend (fail-fast) | subidas de archivos |

  Inventario completo: [`../reference/configuration.md`](../reference/configuration.md).

- El SHA a desplegar existe en GHCR (verificar con
  `docker manifest inspect ghcr.io/alejandrotatum/cata_club-backend:<sha>`).

## Pasos

```bash
# 1. Fijar el SHA inmutable a desplegar (nunca latest)
export IMAGE_TAG=<sha-completo-del-commit>

# 2. Bajar las imágenes del registro (usa la red del host)
docker compose -f docker-compose.yml -f docker-compose.prod.yml pull

# 3. Levantar/actualizar el stack. Los -f explícitos evitan que el override
#    de desarrollo (build:, puertos publicados, mailpit) se cuele.
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

`up -d` honra `mem_limit` y `logging` del overlay de producción, aplica
`restart: unless-stopped` y arranca los servicios en orden de dependencia.
El backend corre `alembic upgrade head` en su entrypoint y **aborta el
arranque** si la migración falla.

```bash
# 4. Instalar/verificar el cron del backup lógico diario (una sola vez; ver
#    backup-restore.md para la convención de rutas /opt/cata-club)
chmod +x /opt/cata-club/scripts/backup/*.sh
mkdir -p /var/backups/cataclub
(crontab -l 2>/dev/null | grep -v 'backup-db.sh' || true
 echo '30 3 * * * cd /opt/cata-club && /opt/cata-club/scripts/backup/backup-db.sh >> /var/log/cataclub-backup.log 2>&1'
) | crontab -
crontab -l | grep backup-db.sh   # verificar que quedó instalado
```

## Validación post-despliegue

```bash
# 1. Todo servicio running y healthy (los que declaran healthcheck)
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps -a

# 2. Sondas del backend DENTRO del contenedor (prod no publica 8000; sin curl: python/urllib)
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T backend \
  python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=5).read().decode())"        # {"estado":"ok"}
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T backend \
  python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/health/ready', timeout=5).read().decode())"  # {"estado":"listo","postgres":"ok","redis":"ok"}

# 3. El sitio responde por el dominio con TLS
curl -fsSI https://$DOMINIO | head -5         # HTTP/2 200 y Strict-Transport-Security

# 4. El backend NO expone /docs en producción (AMBIENTE=production): 404
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T backend \
  python -c "import urllib.request, urllib.error
try: urllib.request.urlopen('http://127.0.0.1:8000/docs', timeout=5)
except urllib.error.HTTPError as e: print(e.code)
else: print('ERROR: /docs responde')"   # 404

# 5. El dump lógico del día existe (backup L2)
ls -lh /var/backups/cataclub/cataclub_$(date +%F).dump

# 5. Logs sin errores de arranque (validar la rotación activa)
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs --tail=200
```

Si la validación 1 o 2 falla: [`incident-response.md`](incident-response.md)
y [`rollback.md`](rollback.md).

## Lo que NO hay que hacer

- **No** desplegar con `latest`: un `docker compose pull` sin aviso podría
  cambiar de versión el único servicio con TLS y puertos públicos.
- **No** correr `docker compose build` en el host de producción: el build del
  frontend fue la causa de OOM medida en un droplet de 2 GB; por eso el
  override de desarrollo (que aporta `build:`) nunca se aplica en
  producción.
- **No** usar `docker compose up` a secas: auto-carga
  `docker-compose.override.yml`. Siempre los dos `-f` explícitos.
- **No** exponer puertos del backend o de la base: en producción solo Caddy
  publica 80/443 (verificado por `tests/test_docker_compose_config.py`).

## Decisión/implementación pendiente

- Ejecutar este runbook contra un entorno real y registrar la evidencia en
  [`production-readiness.md`](production-readiness.md) (pasa de
  *Needs evidence* a *Ready*).
- Automatizar el despliegue en el host (script o herramienta de
  configuración) está fuera de lo existente hoy: `scripts/backup/` ya cubre
  el backup (ver [`backup-restore.md`](backup-restore.md)), pero el
  `deploy.sh` de despliegue sigue pendiente; no simularlo.

Rollback: [`rollback.md`](rollback.md).
