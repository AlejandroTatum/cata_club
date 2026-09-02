# Auditoría de colisiones de correo por capitalización

Procedimiento de **solo lectura** para saber cuántas cuentas de `usuario`
colisionan hoy solo por mayúsculas/minúsculas (`correo` es `unique=True`
case-sensitive, así que `Ana@Club.com` y `ana@club.com` son dos filas).

Fase B de #827 (issue #902). La fase A de #827 -- índice funcional no
único sobre `lower(correo)` -- sigue **abierta** y no entregó nada: esta
auditoría no depende de ese índice ni de ningún otro cambio de esquema.

> **No repara nada.** No hace `UPDATE`, no crea migraciones ni índices
> únicos, y no normaliza ningún correo.

## Prerrequisitos

- Acceso de lectura -- idealmente réplica, o un rol sin permisos de escritura.
- `DATABASE_URL` sale del entorno del release, nunca de un argumento de CLI.

## Comandos

Desde `backend/`:

```bash
uv run python scripts/auditar_colisiones_correo.py
uv run python scripts/auditar_colisiones_correo.py --json
```

Código de salida siempre 0: un bucket en colisión es el resultado esperado.

```bash
TEST_DATABASE_URL=postgresql+psycopg://usuario:password@localhost:5436/cataclub_test \
  uv run pytest tests/test_auditar_colisiones_correo.py -v
```

## Cómo interpretar la salida

- `total_usuarios`: filas totales en `usuario`, colisionen o no.
- `buckets_en_colision`: valores distintos de `lower(correo)` con más de una fila.
- `usuarios_en_colision`: suma de filas dentro de esos buckets.
- Por bucket: `huella`, `cantidad`, `ids` y `activos` (mismo orden, `usuario.activo`).
- `huella` **no es estable**: HMAC-SHA256 de `lower(correo)` con sal aleatoria
  por corrida, nunca persistida -- un hash liso sería enumerable por diccionario.

## Criterios de revisión humana de cada colisión

La auditoría no decide cuál fila es la cuenta "real"; eso lo decide una
persona revisando, por cada `usuario_id` del bucket:

1. **Actividad más reciente**: sesiones, pagos o inscripciones más nuevas.
2. **Volumen de historial**: cuál acumula más membresías/pagos.
3. **Estado `activo`**: una fila `activo = false` suele ser la candidata a retirar.
4. **Misma persona física**: confirmar cédula/teléfono en `persona`.

## Diseño reversible de correo canónico (propuesto, NO aplicado)

1. `@validates("correo")` en `Usuario` con `strip().lower()`.
2. Tabla `usuario_correo_respaldo(usuario_id, correo_original, registrado_en)`
   poblada antes de cualquier `UPDATE`.
3. Solo con `buckets_en_colision: 0`: `CREATE UNIQUE INDEX CONCURRENTLY
   ux_usuario_correo_lower ON usuario (lower(correo))`.

Rollback en orden inverso: `DROP INDEX CONCURRENTLY` (3), restaurar correos
desde el respaldo (2), quitar el `@validates` (1). Toda normalización futura
exige aprobación humana explícita tras revisar este informe; este issue no
aplica ninguno de los tres pasos.

## Lo que este procedimiento NO puede hacer

No decide cuál fila de un bucket es la cuenta correcta -- eso es un juicio
de negocio, no algo automatizable sin riesgo de fusionar la cuenta equivocada.

No detecta colisiones ya resueltas fuera de `usuario.correo` (dos personas
que comparten un correo real bajo cédulas distintas por decisión del club).

## Escalamiento

- Bucket con pagos o membresías activas: no toques nada, escala a quien
  tenga autoridad de negocio.
- Para ejecutar cualquiera de los tres pasos del diseño reversible, abrí un
  issue nuevo con este reporte como evidencia del "antes".
- Ante cualquier duda sobre si una acción es de solo lectura, no la ejecutes.
