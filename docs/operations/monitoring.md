# Monitoring y alerting — baseline para producir

> **Estado:** Activa (guía + propuesta; el mecanismo concreto se decide al
> contratar la herramienta — ver «Decisión» abajo)
>
> **Responsable:** Infraestructura (asignación nominal pendiente — ver
> [`../reference/ownership.md`](../reference/ownership.md))
>
> **Última verificación:** 2026-08-17 · **En la lista viva:** la fila
> *Monitoring* está **Blocked**: sin esto, una caída se descubre porque avisa
> un socio.

## Qué falta y qué ya existe

En el repo **no hay métricas ni trazas** (`rg "prometheus|opentelemetry|statsd"`
→ vacío). Pero la base para un monitoring operativo ya está construida:

| Pieza | Dónde | Para qué sirve |
|---|---|---|
| `/health` | `backend/main.py` | Sonda sin dependencias: la API responde |
| `/health/ready` | `backend/main.py` | Sonda con dependencias: Postgres + Redis OK (503 si una cae) |
| `X-Request-ID` | `backend/main.py` | Correlación de requests en logs |
| `/diagnostico/circuitos` | role ADMINISTRADOR | Estado de los circuit breakers de Cloudinary/SMTP |
| `restart: unless-stopped` | Compose | Los contenedores se recuperan solos de un crash |
| `scripts/ops/check-backup-freshness.sh` | este repo | Falta de backup como señal de alarma (RPO) |

## El mínimo viable (recomendado para abrir producción)

**Monitoreo externo de uptime** contra `/health/ready`. Un servicio ajeno al
droplet pega cada minuto desde afuera — cubre también la caída total del host
(que un monitor interno jamás vería):

| Herramienta | Gratis | Nota |
|---|---|---|
| **UptimeRobot** | 50 monitores, 1 min | El más simple; alerta por email + Telegram + webhook |
| **Better Uptime** | 10 monitores, 1 min | Estado público + agenda de mantenimiento |
| **Uptime Kuma** | self-hosted, ilimitado | Correrlo EN OTRA máquina (no en el droplet productivo) |

Configuración sugerida de cada monitor:

| Campo | Valor |
|---|---|
| Tipo | HTTPS |
| URL | `https://<DOMINIO>/api/v1/health/ready` |
| Intervalo | 1 minuto |
| Umbral de retries | 2 fallos consecutivos antes de alertar |
| Canal | email del operador + Telegram (si se usa) |

> El endpoint público del frontend es `/api/v1/health/ready` (el BFF enruta al
> backend; el backend mismo no se expone). Confirmar la ruta exacta al configurar.

**Chequeo de frescura del backup** (alarma distinta; no la cubre el uptime).

```bash
# Cron otra vez al día, en paralelo al de 03:30 del backup
(crontab -l 2>/dev/null | grep -v 'check-backup-freshness' || true
 echo '35 16 * * * /opt/cata-club/scripts/ops/check-backup-freshness.sh || echo "BACKUP VIEJO O AUSENTE" | mail -s "[Cata Club] Backup" ops@dominio.com'
) | crontab -
```

O integrado al mismo servicio de uptime: muchos permiten monitorear una URL
propia — exponer un endpoint del backend que reporte la edad del dump más reciente.
Lo dejo como mejora al mecanismo L2 (`scripts/backup/`), no para el día uno.

## Qué NO hacer el día uno

- **No** instalar Prometheus/Grafana/OTel todavía: es infraestructura nueva en
  un droplet ajustado, sin equipo para mantenerla. El uptime externo más la
  frescura del backup cubren el 90% del riesgo de apertura por una fracción del
  costo.
- **No** monitorear desde el propio droplet (un monitor que muere con el host no
  avisa nada).

## Decisión pendiente (quién decide y qué)

| Decisión | Propuesta (por defecto si nadie objeta) |
|---|---|
| Herramienta de uptime | **UptimeRobot** (gratis, 1 min, alerta por email+Telegram) |
| Canal de alertas | email del operador + Telegram del mismo |
| Frecuencia | 1 minuto, alertar tras 2 fallos |
| Qué medir en v1 | `/health/ready` (disponibilidad real: API+Postgres+Redis) |
| Backups | frescura diaria (dump < 26h) con alerta separada |

Cuando se decida, cerrar: la fila *Monitoring* de
[`production-readiness.md`](production-readiness.md) pasa de **Blocked** a
*Needs evidence* (mecanismo elegido) y a *Ready* cuando las alertas hayan
disparado de verdad al menos una vez y se haya respondido el incidente
([`incident-response.md`](incident-response.md)).