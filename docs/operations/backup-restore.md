# Runbook de backup y restore

> **Estado:** Activa — mecanismo implementado (17-ago-2026) y restore verificado
> de punta a punta contra el entorno de QA. Falta: instalar el cron en el host
> de producción y ejecutar una verificación allí para pasar a *Ready* en la
> lista viva.
>
> **Responsable:** Infraestructura (asignación nominal pendiente — ver
> [`../reference/ownership.md`](../reference/ownership.md))
>
> **Audiencia:** operador, desarrollo y producto
>
> **Última verificación:** 2026-08-17 · **Verificado contra commit:** `d6a18fe`
>
> **Revisión recomendada:** al tocar el servicio `db`, los scripts de
> `scripts/backup/`, o antes de cada despliegue

## Modelo de capas (qué protege cada cosa)

| Capa | Qué protege | Mecanismo | Estado |
|---|---|---|---|
| **L1 — Backups de disco de DigitalOcean** | Desastre total del droplet (se restaura la máquina entera) | Backups diarios de droplet contratados (30% del costo) — ya incluidos en la propuesta de servicio | Contratado |
| **L2 — Dump lógico Postgres** | Corrupción lógica, borrado accidental, fallas de migración; permite recuperar datos sueltos y **verificar** que el backup funciona | `scripts/backup/backup-db.sh` (diario vía cron) + `scripts/backup/restore-check.sh` | Implementado y verificado en QA |
| **L3 — Copia off-site del dump (futuro)** | Que el droplet Y sus backups se pierdan a la vez | Destino S3-compatible (DO Spaces) — el script ya está parametrizado para cambiar el destino sin rediseñar | Decisión abierta: activar cuando el volumen o el presupuesto lo justifiquen |

## Decisiones tomadas (17-ago-2026)

| Decisión | Valor | Por qué |
|---|---|---|
| **RPO** | 1 dump por día, 03:30 hs | Cumple la promesa del plan: «se pierde, como máximo, un día de movimientos»; corre después de la automatización nocturna (02:30) para incluir sus escrituras |
| **Retención** | 14 dumps | Dos semanas de recovery; costo de disco despreciable en el droplet de 50GB |
| **Destino del dump (L2)** | Disco local del droplet (`/var/backups/cataclub`) | Cero costo extra; la capa de desastre la cubre L1. L3 (off-site) queda documentada para cuando el club crezca |
| **Verificación de restore** | Entorno desechable, nunca el stack productivo | Restaurar en el `db` productivo **borraría la base** (volumen `cataclub_db_data`) |
| **Secretos** | Nunca en scripts ni cron | El dump usa las credenciales DENTRO del contenedor `db` |

## Cómo funciona `backup-db.sh`

- Saca `pg_dump --format=custom` (comprimido) del servicio `db` con las
  credenciales del propio contenedor (`sh -c 'pg_dump -U "$POSTGRES_USER" -d
  "$POSTGRES_DB" ...'`): ningún secreto vive en el script ni en el cron.
- Escribe atómico (`cataclub_AAAA-MM-DD.dump.tmp` → `mv`): un fallo a mitad de
  camino nunca deja un archivo que parezca válido.
- Rota conservando los 14 más nuevos (`find` + `sort -r` + `tail`).
- Sale con `exit != 0` si algo falla: el log y el monitoreo lo ven.

Configuración por variables de entorno (todas con default útil):

| Variable | Default | Uso |
|---|---|---|
| `BACKUP_DIR` | `/var/backups/cataclub` | Dónde quedan los dumps |
| `BACKUP_STACK_DIR` | cwd | Directorio con los archivos de compose |
| `BACKUP_COMPOSE_FILES` | `-f docker-compose.yml -f docker-compose.prod.yml` | Capa de producción; en QA se pasan las 3 de la Makefile |
| `BACKUP_RETENTION` | `14` | Dumps conservados |

## Instalación en el host de producción (una vez)

El repo vive en `/opt/cata-club` y el cron se instala una sola vez (lo hará
`deploy.sh` cuando exista):

```bash
# Convención de rutas del host (usada por deploy.sh y por esta doc)
#   repo:  /opt/cata-club
#   dumps: /var/backups/cataclub
#   log:   /var/log/cataclub-backup.log

chmod +x /opt/cata-club/scripts/backup/*.sh
mkdir -p /var/backups/cataclub

# Dump diario a las 03:30, log aparte; el cron debe correr como root (o con
# acceso al socket de docker y al grupo del stack).
(crontab -l 2>/dev/null | grep -v 'backup-db.sh' || true
 echo '30 3 * * * cd /opt/cata-club && /opt/cata-club/scripts/backup/backup-db.sh >> /var/log/cataclub-backup.log 2>&1'
) | crontab -
```

Verificación manual en producción (mismo comando que correrá el cron):

```bash
cd /opt/cata-club
./scripts/backup/backup-db.sh
ls -lh /var/backups/cataclub/
```

## Verificación de restore (`restore-check.sh`)

NUNCA restaura contra el stack productivo ni su volumen. Levanta un Postgres
efímero (`--rm`, puerto 55432), restaura el dump, valida y lo destruye (trap).

```bash
# Revision que espera el SHA desplegado:
cd backend && uv run alembic heads        # de1413036789 en d6a18fe

# Verificación de punta a punta:
./scripts/backup/restore-check.sh /var/backups/cataclub/cataclub_AAAA-MM-DD.dump \
  --expect-revision <revision-esperada>
```

Valida: el dump restaura sin errores, `alembic_version` existe (y coincide con
la revisión esperada), y los conteos de `persona`, `membresia`, `pago` y
`asistencia` se imprimen (contrastar contra el origen).

### Evidencia registrada — verificación QA 2026-08-17

Dump del stack de QA (`cataclub_2026-08-17.dump`, 104K) restaurado y validado:

| Tabla | Origen (QA) | Restaurado | Resultado |
|---|---|---|---|
| `persona` | 86 | 86 | ✅ |
| `membresia` | 66 | 66 | ✅ |
| `pago` | 62 | 62 | ✅ |
| `asistencia` | 516 | 516 | ✅ |

`alembic_version`: `de1413036789` en origen y en el dump ✅. Rotación probada
con 20 dumps ficticios: conserva los 14 más nuevos ✅. Entorno desechable
destruido al terminar (sin contenedores colgados).

**Lo que falta para *Ready* (lista viva):** instalar el cron en el host de
producción y repetir esta verificación con un dump real de producción cuando
esté en línea. El restore contra la base productiva sigue prohibido por diseño.

## Restauración real ante un incidente

1. Si el droplet sigue vivo: recuperar el dump más reciente de
   `/var/backups/cataclub` (o el backup de disco L1 si el host murió).
2. Restaurar en un entorno desechable y verificarlo con `restore-check.sh`
   ANTES de tocar nada.
3. Recién entonces, en el stack productivo: `pg_restore` contra el `db` con el
   stack detenido, o degradar y reconstruir el volumen `cataclub_db_data`.
4. Validar `/health/ready` del backend y conteos clave.
5. Registrar la operación como evidencia en la lista viva.

Protocolo de incidente mayor: [`incident-response.md`](incident-response.md) ·
Regresión de despliegue: [`rollback.md`](rollback.md)