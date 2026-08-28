"""
Pruebas de la migración `a790verifcorreo` (agrega `usuario.correo_verificado`
y la tabla `verificacion_correo_outbox`) mediante el arnés de migraciones.

Por qué el arnés y no la suite normal: el job `migraciones-desde-cero` de CI y
la fixture `esquema_migrado` solo demuestran que `alembic upgrade head` corre
contra una base VACÍA. Acá el riesgo vive justamente en la base que YA tiene
filas: el club tiene representantes reales creados antes de que existiera
ninguna verificación de correo. Una migración que los dejara sin verificar
los dejaría sin poder vincular a sus propios hijos, y un despliegue que
desactiva en silencio a los tutores de verdad es peor que el agujero que
viene a cerrar.

La decisión, por lo tanto: las cuentas preexistentes quedan VERIFICADAS
(grandfathering). No reabre nada -- el eslabón que el issue #790 cierra es la
autoinscripción PÚBLICA, y desde esta revisión ninguna cuenta nueva nace
verificada.

Se verifica, sobre datos preexistentes, que:
  1. Ni la columna ni la tabla existían antes (ancla contra drift).
  2. Las cuentas que ya vivían en la base quedan verificadas, con el resto de
     sus datos y su rol REPRESENTANTE intactos.
  3. El default del ESQUEMA para filas nuevas es `false`: una inserción cruda
     que saltee el ORM nace sin verificar, nunca al revés.
  4. El `downgrade()` es real y la ida y vuelta no rompe nada.
"""
from tests.arnes_migraciones import ArnesMigracion


REVISION_ANTERIOR = "e762rolunico"
REVISION_VERIFICACION = "a790verifcorreo"

SQL_COLUMNA = (
    "SELECT column_name, is_nullable, column_default FROM information_schema.columns "
    "WHERE table_name = 'usuario' AND column_name = 'correo_verificado'"
)
SQL_TABLA_OUTBOX = (
    "SELECT table_name FROM information_schema.tables "
    "WHERE table_schema = 'public' AND table_name = 'verificacion_correo_outbox'"
)


def _sembrar_cuentas(arnes: ArnesMigracion) -> None:
    """Siembra con SQL crudo (nunca vía el ORM: el ORM describe el esquema de
    HOY, no el de la revisión bajo prueba) dos cuentas como las que ya viven
    en producción: un representante con su representado y un administrador."""
    arnes.ejecutar(
        """
        INSERT INTO persona (id, nombres, apellidos, cedula, fecha_nacimiento,
                             telefono, fecha_registro, activo)
        VALUES
          (1, 'Marcela', 'Vega', '1710034065', DATE '1985-01-01',
           '0991234567', TIMESTAMPTZ '2024-03-01 12:00:00+00', TRUE),
          (2, 'Lucas', 'Vega', '1710034073', DATE '2015-06-10',
           '0997654321', TIMESTAMPTZ '2024-04-01 12:00:00+00', TRUE),
          (3, 'Admin', 'Club', '1710034081', DATE '1980-02-02',
           '0990000000', TIMESTAMPTZ '2024-01-01 12:00:00+00', TRUE)
        """
    )
    arnes.ejecutar("UPDATE persona SET representante_id = 1 WHERE id = 2")
    arnes.ejecutar(
        """
        INSERT INTO usuario (id, correo, contrasenia, persona_id, fecha_creacion,
                             version_contrasenia, activo, version_sesion)
        VALUES
          (1, 'marcela@cataclub.test', 'hash', 1,
           TIMESTAMPTZ '2024-03-01 12:00:00+00', 1, TRUE, 1),
          (2, 'admin@cataclub.test', 'hash', 3,
           TIMESTAMPTZ '2024-01-01 12:00:00+00', 1, TRUE, 1)
        """
    )
    arnes.ejecutar(
        """
        INSERT INTO rol (id, tipo_rol, descripcion) VALUES
          (1, 'REPRESENTANTE', 'Representante'),
          (2, 'ADMINISTRADOR', 'Administrador')
        """
    )
    arnes.ejecutar(
        "INSERT INTO usuario_rol (usuario_id, rol_id) VALUES (1, 1), (2, 2)"
    )


def test_nada_de_esto_existia_antes_de_la_migracion(arnes_migracion):
    """Ancla: si dejara de fallar sin la migración, la columna o la tabla
    llegaron al esquema por otra vía (drift)."""
    arnes_migracion.preparar(REVISION_ANTERIOR)

    assert arnes_migracion.consultar(SQL_COLUMNA) == []
    assert arnes_migracion.consultar(SQL_TABLA_OUTBOX) == []


def test_los_representantes_que_ya_existian_quedan_verificados(arnes_migracion):
    """El caso que `migraciones-desde-cero` no puede detectar. Si esto fallara,
    el despliegue dejaría a los tutores reales del club sin poder vincular a
    sus propios hijos."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_cuentas(arnes_migracion)

    arnes_migracion.migrar(REVISION_VERIFICACION)

    assert arnes_migracion.consultar(
        "SELECT id, correo, activo, correo_verificado FROM usuario ORDER BY id"
    ) == [
        (1, "marcela@cataclub.test", True, True),
        (2, "admin@cataclub.test", True, True),
    ]


def test_el_vinculo_y_el_rol_preexistentes_sobreviven(arnes_migracion):
    """La migración no toca ni la representación ya establecida ni los roles:
    solo agrega el dato que faltaba."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_cuentas(arnes_migracion)

    arnes_migracion.migrar(REVISION_VERIFICACION)

    assert arnes_migracion.consultar(
        "SELECT id, representante_id FROM persona ORDER BY id"
    ) == [(1, None), (2, 1), (3, None)]
    assert arnes_migracion.consultar(
        "SELECT u.correo, r.tipo_rol FROM usuario u "
        "JOIN usuario_rol ur ON ur.usuario_id = u.id "
        "JOIN rol r ON r.id = ur.rol_id ORDER BY u.id"
    ) == [("marcela@cataclub.test", "REPRESENTANTE"), ("admin@cataclub.test", "ADMINISTRADOR")]


def test_una_cuenta_nueva_nace_sin_verificar_aunque_saltee_el_orm(arnes_migracion):
    """El `server_default` se conserva en `false` a propósito, al revés que en
    `persona.activo`: acá el default del esquema es una compuerta de seguridad,
    no andamiaje del backfill. Un INSERT crudo que no mencione la columna debe
    caer del lado seguro."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_cuentas(arnes_migracion)
    arnes_migracion.migrar(REVISION_VERIFICACION)

    arnes_migracion.ejecutar(
        """
        INSERT INTO persona (id, nombres, apellidos, cedula, fecha_nacimiento,
                             telefono, fecha_registro, activo)
        VALUES (4, 'Nueva', 'Cuenta', '1710034099', DATE '1992-09-09',
                '0991111111', TIMESTAMPTZ '2026-08-27 12:00:00+00', TRUE)
        """
    )
    arnes_migracion.ejecutar(
        """
        INSERT INTO usuario (id, correo, contrasenia, persona_id, fecha_creacion,
                             version_contrasenia, activo, version_sesion)
        VALUES (3, 'nueva@cataclub.test', 'hash', 4,
                TIMESTAMPTZ '2026-08-27 12:00:00+00', 1, TRUE, 1)
        """
    )

    assert arnes_migracion.consultar(
        "SELECT correo_verificado FROM usuario WHERE id = 3"
    ) == [(False,)]
    assert arnes_migracion.consultar(SQL_COLUMNA) == [
        ("correo_verificado", "NO", "false")
    ]


def test_el_outbox_queda_con_su_indice_parcial_unico(arnes_migracion):
    """Una sola verificación activa por cuenta: es lo que permite que el
    reenvío reuse la fila en vez de acumular trabajo duplicado."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_cuentas(arnes_migracion)

    arnes_migracion.migrar(REVISION_VERIFICACION)

    assert arnes_migracion.consultar(SQL_TABLA_OUTBOX) == [
        ("verificacion_correo_outbox",)
    ]
    indices = {
        fila[0] for fila in arnes_migracion.consultar(
            "SELECT indexname FROM pg_indexes "
            "WHERE tablename = 'verificacion_correo_outbox'"
        )
    }
    assert "uq_verificacion_correo_outbox_usuario_activo" in indices
    assert "ix_verificacion_correo_outbox_pending_next" in indices


def test_downgrade_y_upgrade_hacen_ida_y_vuelta(arnes_migracion):
    """`downgrade()` es real, no un `pass`: deja la base en un estado desde el
    que `upgrade` vuelve a funcionar sobre las mismas filas."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_cuentas(arnes_migracion)
    arnes_migracion.migrar(REVISION_VERIFICACION)

    arnes_migracion.revertir(REVISION_ANTERIOR)
    assert arnes_migracion.consultar(SQL_COLUMNA) == []
    assert arnes_migracion.consultar(SQL_TABLA_OUTBOX) == []
    assert arnes_migracion.revision_actual() == REVISION_ANTERIOR

    arnes_migracion.migrar(REVISION_VERIFICACION)
    assert arnes_migracion.consultar(
        "SELECT id, correo_verificado FROM usuario ORDER BY id"
    ) == [(1, True), (2, True)]
