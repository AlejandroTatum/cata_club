"""
Prueba de la migración que convierte las columnas `DateTime` a `timestamptz`.

El bug que cierra:
    `_ahora_utc()` (`app/dominio/modelos.py`) devuelve un datetime AWARE en
    UTC, pero las columnas eran `timestamp without time zone`. Postgres
    descarta el offset al guardar: el valor almacenado depende del `TimeZone`
    de la sesión que escribió, y el instante original ya no es recuperable
    desde la BD. Hoy funciona solo porque los contenedores corren en UTC —
    es una corrección accidental, no una garantía.

Por qué la migración necesita `USING columna AT TIME ZONE 'UTC'`:
    Sin esa cláusula, `ALTER COLUMN ... TYPE timestamptz` reinterpreta cada
    valor naive existente en la zona del SERVIDOR. Si el servidor no está en
    UTC (o alguien cambia `TimeZone` alguna vez), el corrimiento se
    hornearía en los datos de forma permanente e irreversible. Esta prueba
    corre la migración con el servidor en `America/Guayaquil` (UTC-5)
    justamente para que ese error no pueda pasar desapercibido.
"""
from datetime import datetime, timezone

from tests.arnes_migraciones import ArnesMigracion


REVISION_PREVIA = "644d352bf590"

# Zona del club. Si la migración olvidara el `AT TIME ZONE 'UTC'`, correrla
# bajo esta zona correría cada instante 5 horas y la prueba lo detectaría.
ZONA_NO_UTC = "America/Guayaquil"

# Instante de referencia sembrado en TODAS las columnas. Se elige de noche
# (23:30 UTC = 18:30 en Guayaquil) para que un corrimiento de 5 horas también
# cambie el día, no solo la hora.
INSTANTE_SEMBRADO_NAIVE = "2026-01-15 23:30:00"
INSTANTE_ESPERADO = datetime(2026, 1, 15, 23, 30, tzinfo=timezone.utc)

# Las 10 columnas `DateTime` del modelo (`app/dominio/modelos.py`), que antes
# de esta migración eran todas `timestamp without time zone`.
COLUMNAS_FECHA_HORA = [
    ("usuario", "fecha_creacion"),
    ("persona", "fecha_registro"),
    ("membresia", "fecha_activacion"),
    ("pago", "fecha_registro"),
    ("pago", "fecha_validacion"),
    ("pago", "voucher_fecha_carga"),
    ("comprobante_pago", "fecha_carga"),
    ("asistencia", "fecha_registro"),
    ("alumno_horario", "fecha_asignacion"),
    ("notificacion", "fecha_creacion"),
]


def _sembrar_una_fila_por_tabla(arnes: ArnesMigracion) -> None:
    """Siembra una fila en cada tabla con columnas de fecha-hora, todas con
    el MISMO instante, para poder afirmar que ninguna se corrió."""
    ts = f"TIMESTAMP '{INSTANTE_SEMBRADO_NAIVE}'"
    arnes.ejecutar(f"""
        INSERT INTO persona (id, nombres, apellidos, cedula, fecha_nacimiento,
                             telefono, fecha_registro)
        VALUES (1, 'Ana', 'Torres', '1710034065', DATE '1990-01-01',
                '0991234567', {ts})
    """)
    arnes.ejecutar(f"""
        INSERT INTO usuario (id, correo, contrasenia, fecha_creacion,
                             persona_id, version_contrasenia, activo)
        VALUES (1, 'ana@cataclub.test', 'hash', {ts}, 1, 0, true)
    """)
    arnes.ejecutar("""
        INSERT INTO tipo_membresia (id, categoria, franja_horaria, precio, modalidad)
        VALUES (1, 'JUVENIL', 'MATUTINA', 30.00, 'MENSUAL')
    """)
    arnes.ejecutar(f"""
        INSERT INTO membresia (id, estado, monto_aplicado, fecha_activacion,
                               persona_id, tipo_membresia_id, es_gratuidad_familiar)
        VALUES (1, 'ACTIVA', 30.00, {ts}, 1, 1, false)
    """)
    arnes.ejecutar(f"""
        INSERT INTO pago (id, monto, estado_pago, tipo_pago, fecha_registro,
                          fecha_validacion, fecha_inicio, fecha_fin, persona_id,
                          membresia_id, voucher_fecha_carga)
        VALUES (1, 30.00, 'APROBADO', 'TRANSFERENCIA', {ts}, {ts},
                DATE '2026-01-01', DATE '2026-01-31', 1, 1, {ts})
    """)
    arnes.ejecutar(f"""
        INSERT INTO comprobante_pago (id, archivo_url, formato_archivo, fecha_carga, pago_id)
        VALUES (1, 'https://ejemplo.test/c.pdf', 'pdf', {ts}, 1)
    """)
    arnes.ejecutar("""
        INSERT INTO horario_entrenamiento (id, dia_semana, hora_inicio, hora_fin,
                                           entrenador_id, categoria)
        VALUES (1, 'LUNES', TIME '08:00', TIME '10:00', 1, 'JUVENIL')
    """)
    arnes.ejecutar(f"""
        INSERT INTO asistencia (id, fecha_entrenamiento, fecha_registro, estado,
                                persona_id, entrenador_id, horario_id)
        VALUES (1, DATE '2026-01-15', {ts}, 'PRESENTE', 1, 1, 1)
    """)
    arnes.ejecutar(f"""
        INSERT INTO alumno_horario (id, persona_id, horario_id, fecha_asignacion)
        VALUES (1, 1, 1, {ts})
    """)
    arnes.ejecutar(f"""
        INSERT INTO notificacion (id, tipo, mensaje, leida, fecha_creacion, persona_id)
        VALUES (1, 'PAGO_APROBADO', 'Pago aprobado', false, {ts}, 1)
    """)


def test_columnas_de_fecha_hora_quedan_como_timestamptz(arnes_migracion):
    arnes_migracion.preparar(REVISION_PREVIA, zona_horaria_servidor=ZONA_NO_UTC)

    arnes_migracion.migrar("head")

    tipos = {
        (tabla, columna): arnes_migracion.tipo_de_columna(tabla, columna)
        for tabla, columna in COLUMNAS_FECHA_HORA
    }
    assert tipos == {
        clave: "timestamp with time zone" for clave in tipos
    }


def test_los_instantes_preexistentes_no_se_corren(arnes_migracion):
    """El corazón de la prueba: los valores naive guardados ya eran UTC, así
    que después de la conversión deben seguir apuntando al MISMO instante,
    sin importar la zona del servidor que corre la migración."""
    arnes_migracion.preparar(REVISION_PREVIA, zona_horaria_servidor=ZONA_NO_UTC)
    _sembrar_una_fila_por_tabla(arnes_migracion)

    arnes_migracion.migrar("head")

    leidos = {}
    for tabla, columna in COLUMNAS_FECHA_HORA:
        (valor,) = arnes_migracion.consultar(
            f"SELECT {columna} FROM {tabla} WHERE id = 1"
        )[0]
        leidos[(tabla, columna)] = valor.astimezone(timezone.utc)

    assert leidos == {clave: INSTANTE_ESPERADO for clave in leidos}


def test_la_migracion_es_reversible(arnes_migracion):
    """`downgrade()` debe devolver las columnas a naive conservando el
    instante en UTC — un rollback nunca debe corromper los datos."""
    arnes_migracion.preparar(REVISION_PREVIA, zona_horaria_servidor=ZONA_NO_UTC)
    _sembrar_una_fila_por_tabla(arnes_migracion)
    arnes_migracion.migrar("head")

    arnes_migracion.revertir(REVISION_PREVIA)

    assert arnes_migracion.tipo_de_columna("usuario", "fecha_creacion") == (
        "timestamp without time zone"
    )
    assert arnes_migracion.consultar(
        "SELECT fecha_creacion FROM usuario WHERE id = 1"
    ) == [(datetime(2026, 1, 15, 23, 30),)]


def test_el_orm_guarda_y_recupera_el_offset(db_session):
    """Contrato del lado del ORM: escribir un datetime aware en cualquier
    zona y recuperarlo como el mismo instante aware. Con columnas naive esto
    no se cumplía: SQLAlchemy devolvía un datetime SIN tzinfo y el instante
    dependía del `TimeZone` del servidor."""
    from datetime import timedelta
    from app.dominio.modelos import Persona, Usuario

    zona_guayaquil = timezone(timedelta(hours=-5))
    instante_local = datetime(2026, 1, 15, 18, 30, tzinfo=zona_guayaquil)

    persona = Persona(
        nombres="Ana", apellidos="Torres", cedula="1710034065",
        fecha_nacimiento=datetime(1990, 1, 1).date(), telefono="0991234567",
    )
    db_session.add(persona)
    db_session.flush()
    usuario = Usuario(
        correo="ana.tz@cataclub.test", contrasenia="hash",
        persona_id=persona.id, fecha_creacion=instante_local,
    )
    db_session.add(usuario)
    db_session.commit()
    db_session.expire_all()

    recuperado = db_session.get(Usuario, usuario.id)
    assert recuperado.fecha_creacion.tzinfo is not None
    assert recuperado.fecha_creacion == INSTANTE_ESPERADO
