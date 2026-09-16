# Runbook: restore de PostgreSQL con reaplicación de supresiones (issue #1062, D6)

## Problema

Un restore desde un backup **anterior** reintroduce los datos identificables
de las personas cuya supresión ya se había **EJECUTADO** después de la fecha
de ese backup. La decisión D6 del dueño: **las erasures se reaplican ANTES de
que el sistema restaurado vuelva a abrirse**, con mecanismo probado.

## Mecanismo

`scripts/backup/reaplicar_supresiones.py`, en dos fases con UN solo criterio
de "borrado": la reaplicación re-ejecuta `SupresionDatosServicio` (mismo
código que la supresión original, mismas guardias D2/D3/D8, misma destrucción
Cloudinary). El script NUNCA reimplementa el scrub.

- **export** — contra la base VIVA, antes de decomisionarla: vuelca a JSON
  las solicitudes `EJECUTADA` (id de solicitud y persona, fechas, motivo,
  notas).
- **reapply** — contra la base RESTAURADA: por cada supresión exportada,
  - ya `EJECUTADA` en la restaurada → **SKIP** (idempotente);
  - persona ya suprimida → **SKIP** (nada identificable; si falta la fila de
    la solicitud, se reasienta `EJECUTADA` para la auditoría);
  - solicitud ausente (creada después del backup) → se **RECREA** desde el
    export y se ejecuta;
  - solicitud `RECIBIDA` (el backup precede a la aprobación) → se aprueba y
    se ejecuta;
  - guardia bloqueante (D2 representados, D3 pagos pendientes sin notas) →
    **FALLO reportado**: es una discrepancia real reintroducida por el
    backup, que el admin resuelve a mano. Nunca es un skip silencioso.

El script corre con el **venv del backend** (importa `app.*` a propósito):

```bash
# Fase 1 — ANTES de decomisionar la base viva
cd backend && uv run python ../scripts/backup/reaplicar_supresiones.py \
    export --db-url "postgresql+psycopg://..." -o /root/supresiones.json

# ... restore habitual (ver restore-check.sh; NUNCA contra el volumen
# productivo sin paso previo de verificación) ...

# Fase 2 — contra la base RESTAURADA, ANTES de reabrir el sistema
cd backend && uv run python ../scripts/backup/reaplicar_supresiones.py \
    reapply --db-url "postgresql+psycopg://..." \
    --admin-persona-id <id-del-admin-actor> /root/supresiones.json
```

Sin `--db-url` usa `DATABASE_URL` del entorno. El exit code de `reapply` es
`!= 0` si alguna reaplicación falló o fue bloqueada: **úsalo como gate**.
`REAPLICACION INCOMPLETA` ⇒ el sistema NO se reabre.

## Procedimiento completo

1. **Exportar** las `EJECUTADA` de la base viva (fase 1 arriba). Guardar el
   JSON junto al dump restaurable.
2. Detener la aplicación (el sistema queda CERRADO para usuarios).
3. Verificar el dump con `scripts/backup/restore-check.sh` en su Postgres
   desechable (puerto 55432) — no restaurar a ciegas.
4. Restaurar contra la base objetivo.
5. **Reaplicar** (fase 2 arriba). Revisar el reporte por persona:
   `REAPLICADA` / `SKIP_*` son normales; cualquier `FALLO` exige resolución
   manual (transferir representación, resolver/documentar el pago pendiente)
   y re-corrida — el mecanismo es idempotente, re-correr es seguro.
6. Solo con `REAPLICACION OK`: reabrir el sistema.

## Honestidad del export (brecha de completitud)

La nómina del export es completa **solo si la fase 1 corrió contra la base
viva legible**. Si la base viva está ILEGIBLE (disco muerto) y se usa el
último export disponible, hay una ventana sin cubrir: supresiones ejecutadas
entre ese export y el incidente no estarán en la lista. En ese caso el
operador debe **registrar la brecha explícitamente** (fecha del export vs.
fecha del incidente) y, si existen logs de la API, reconstruir la nómina
faltante a mano. El script nunca afirma completitud que no tiene: es
responsabilidad del operador no atribuírsela.

## Brecha de retención (no confundir)

`backup-db.sh` **no expira** backups: la rotación real es regla de lifecycle
del object store. Un restore desde un backup MUY viejo puede reintroducir
datos de personas suprimidas hace mucho; este mecanismo cubre exactamente ese
caso, pero solo para las supresiones que estén en el export.

## Pruebas

`backend/tests/test_reaplicacion_supresiones.py` (Postgres real vía
`db-test`): export construido desde una ejecución real del servicio; restore
simulado al estado pre-ejecución; reapply produce el estado suprimido +
`EJECUTADA`; recreación de solicitud ausente; segunda pasada idempotente;
persona ya suprimida con solicitud ausente; guardia D3 bloqueante reportada
con persona aún identificable y predicado de exit code.
