"""Reaplicación de supresiones sobre una base restaurada (issue #1062, T6/D6).

El mecanismo, contra Postgres real (`db-test`): un restore desde un backup
anterior reintroduce identidad ya suprimida. El export se construye desde una
ejecución REAL del servicio (no un JSON a mano) y el estado "restaurado" se
simula devolviendo persona y solicitud a su estado pre-ejecución, que es
exactamente lo que un backup viejo contiene.
"""

from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys

import pytest

from app.dominio.enums import (
    EstadoMembresia, EstadoPago, TipoModalidad, TipoPago,
)
from app.dominio.modelos import (
    Membresia, Pago, Persona, SolicitudSupresionDatos, TipoMembresia,
)
from app.servicios_negocio.supresion_datos_servicio import (
    DIAS_GRACIA,
    SupresionDatosServicio,
)

# El script vive fuera de `backend/`: se importa por ruta de archivo, igual
# que lo haría el operador, para verificar también que el seam de import
# (`sys.path` hacia backend) funciona desde su ubicación real.
_SCRIPTS_BACKUP = (
    Path(__file__).resolve().parent.parent.parent / "scripts" / "backup"
)
sys.path.insert(0, str(_SCRIPTS_BACKUP))

import reaplicar_supresiones as reaplicador  # noqa: E402


# --- Fábricas mínimas -----------------------------------------------------------
def _crear_persona(db_session, cedula="1710034065", nombres="Ana", apellidos="Vega"):
    persona = Persona(
        nombres=nombres, apellidos=apellidos, cedula=cedula,
        fecha_nacimiento=datetime(1990, 1, 1).date(), telefono="0990000000",
    )
    db_session.add(persona)
    db_session.commit()
    db_session.refresh(persona)
    return persona


def _crear_admin(db_session):
    return _crear_persona(db_session, cedula="1710010008", nombres="Admin",
                          apellidos="Club")


def _crear_pago_pendiente(db_session, persona):
    from decimal import Decimal

    tipo = TipoMembresia(
        categoria="JUVENIL", precio=Decimal("30.00"), modalidad=TipoModalidad.MENSUAL,
    )
    db_session.add(tipo)
    db_session.flush()
    membresia = Membresia(
        estado=EstadoMembresia.ACTIVA, monto_aplicado=Decimal("30.00"),
        fecha_activacion=datetime(2029, 3, 1, tzinfo=timezone.utc),
        persona_id=persona.id, tipo_membresia_id=tipo.id,
    )
    db_session.add(membresia)
    db_session.flush()
    pago = Pago(
        monto=Decimal("30.00"), estado_pago=EstadoPago.PENDIENTE_VALIDACION,
        tipo_pago=TipoPago.EFECTIVO, fecha_inicio=datetime(2029, 3, 1).date(),
        fecha_fin=datetime(2029, 3, 31).date(), persona_id=persona.id,
        membresia_id=membresia.id,
    )
    db_session.add(pago)
    db_session.commit()
    return pago


class _CloudinaryFalso:
    def __call__(self, nombre_publico, *, carpeta, resource_type, tipo, descripcion):
        self.ultima = nombre_publico


@pytest.fixture()
def cloudinary_falso(monkeypatch):
    falso = _CloudinaryFalso()
    monkeypatch.setattr(
        "app.servicios_negocio.supresion_datos_servicio.eliminar_recurso_privado",
        falso,
    )
    return falso


def _ejecutar_supresion_real(db_session, persona):
    """Supresión REAL vía servicio (mismo camino que producción) y su export."""
    servicio = SupresionDatosServicio(db_session)
    solicitud = servicio.crear(persona.id, "cierre de cuenta", admin_persona_id=1)
    solicitud.fecha_solicitud = datetime.now(timezone.utc) - timedelta(
        days=DIAS_GRACIA + 1
    )
    db_session.commit()
    servicio.aprobar(solicitud.id, admin_persona_id=1)
    servicio.ejecutar(solicitud.id, admin_persona_id=1)
    return reaplicador.exportar_supresiones(db_session)


def _simular_restore_previo(db_session, solicitud_id, persona):
    """Devuelve persona y solicitud al estado que tendría un backup ANTERIOR
    a la ejecución: identidad reintroducida, solicitud APROBADA pendiente."""
    db_session.expire_all()
    persona = db_session.get(Persona, persona.id)
    persona.nombres = "Ana"
    persona.apellidos = "Vega"
    persona.cedula = "1710034065"
    persona.fecha_nacimiento = datetime(1990, 1, 1).date()
    persona.telefono = "0990000000"
    solicitud = db_session.get(SolicitudSupresionDatos, solicitud_id)
    solicitud.estado = "APROBADA"
    solicitud.fecha_ejecucion = None
    solicitud.detalle_ejecucion = None
    db_session.commit()


# --- T6: el mecanismo ------------------------------------------------------------


def _sin_fallos(resultados):
    return not reaplicador._hubo_fallos(resultados)


def test_reapply_suprime_persona_del_backup_reintroducida(db_session, cloudinary_falso):
    """Export real -> restore simulado -> reapply deja el mismo estado EJECUTADA."""
    admin = _crear_admin(db_session)
    persona = _crear_persona(db_session)
    export = _ejecutar_supresion_real(db_session, persona)
    solicitud_id = export["solicitudes"][0]["solicitud_id"]
    _simular_restore_previo(db_session, solicitud_id, persona)
    db_session.expire_all()
    # El restore reintrodujo la identidad...
    assert db_session.get(Persona, persona.id).nombres == "Ana"
    # ...y la solicitud volvió a APROBADA.
    assert db_session.get(SolicitudSupresionDatos, solicitud_id).estado == "APROBADA"

    resultados = reaplicador.reaplicar_supresiones(db_session, export, admin.id)

    db_session.expire_all()
    assert resultados == [
        {
            "persona_id": persona.id,
            "solicitud_id": solicitud_id,
            "resultado": "REAPLICADA",
            "detalle": resultados[0]["detalle"],
        }
    ]
    persona_tras = db_session.get(Persona, persona.id)
    assert persona_tras.nombres == "ANONIMIZADO"
    assert persona_tras.cedula.startswith("30")
    solicitud_tras = db_session.get(SolicitudSupresionDatos, solicitud_id)
    assert solicitud_tras.estado == "EJECUTADA"
    assert solicitud_tras.fecha_ejecucion is not None
    assert solicitud_tras.detalle_ejecucion


def test_reapply_recrea_solicitud_ausente_en_el_backup(db_session, cloudinary_falso):
    """Solicitud creada DESPUÉS del backup: el restore no la tiene; se recrea
    desde el export y se ejecuta por el mismo servicio."""
    admin = _crear_admin(db_session)
    persona = _crear_persona(db_session, cedula="1710034024")
    export = _ejecutar_supresion_real(db_session, persona)
    solicitud_id = export["solicitudes"][0]["solicitud_id"]
    # El backup es anterior a la solicitud: fila ausente, persona identificable.
    db_session.delete(db_session.get(SolicitudSupresionDatos, solicitud_id))
    persona.nombres = "Ana"
    db_session.commit()

    resultados = reaplicador.reaplicar_supresiones(db_session, export, admin.id)

    db_session.expire_all()
    assert "fallo" not in resultados[0]
    assert resultados[0]["resultado"] == "REAPLICADA"
    assert resultados[0]["solicitud_id"] == solicitud_id
    assert db_session.get(Persona, persona.id).nombres == "ANONIMIZADO"
    solicitud = db_session.get(SolicitudSupresionDatos, solicitud_id)
    assert solicitud.estado == "EJECUTADA"
    assert solicitud.motivo == "cierre de cuenta"


def test_reapply_es_idempotente_segunda_pasada_todo_skip(db_session, cloudinary_falso):
    admin = _crear_admin(db_session)
    persona = _crear_persona(db_session, cedula="1710034032")
    export = _ejecutar_supresion_real(db_session, persona)

    primera = reaplicador.reaplicar_supresiones(db_session, export, admin.id)
    segunda = reaplicador.reaplicar_supresiones(db_session, export, admin.id)

    assert primera[0]["resultado"] == "SKIP_EJECUTADA"  # el restore ya la tenía
    assert segunda[0]["resultado"] == "SKIP_EJECUTADA"
    assert _sin_fallos(segunda)
    db_session.expire_all()
    assert db_session.get(Persona, persona.id).nombres == "ANONIMIZADO"


def test_reapply_con_persona_ya_suprimida_y_solicitud_ausente(db_session,
                                                              cloudinary_falso):
    """Restore posterior a la ejecución: persona suprimida, fila de solicitud
    perdida. Nada identificable que borrar; la decisión se reasienta."""
    admin = _crear_admin(db_session)
    persona = _crear_persona(db_session, cedula="1710034040")
    export = _ejecutar_supresion_real(db_session, persona)
    solicitud_id = export["solicitudes"][0]["solicitud_id"]
    db_session.delete(db_session.get(SolicitudSupresionDatos, solicitud_id))
    db_session.commit()

    resultados = reaplicador.reaplicar_supresiones(db_session, export, admin.id)

    db_session.expire_all()
    assert resultados[0]["resultado"] == "SKIP_YA_SUPRIMIDA"
    reasentada = db_session.get(SolicitudSupresionDatos, solicitud_id)
    assert reasentada.estado == "EJECUTADA"
    assert "reaplicación" in reasentada.detalle_ejecucion
    assert _sin_fallos(resultados)


def test_guardia_bloqueante_en_reapply_falla_con_reporte_y_salida_no_cero(
    db_session, cloudinary_falso, monkeypatch
):
    """D3 contra datos RESTAURADOS: el backup reintrodujo un pago pendiente y
    la solicitud sin notas. La reaplicación es una discrepancia reportada, no
    un skip silencioso, y la persona sigue identificable."""
    admin = _crear_admin(db_session)
    persona = _crear_persona(db_session, cedula="1710034057")
    export = _ejecutar_supresion_real(db_session, persona)
    solicitud_id = export["solicitudes"][0]["solicitud_id"]
    _simular_restore_previo(db_session, solicitud_id, persona)
    # El backup viejo trae un pago PENDIENTE_VALIDACION y la solicitud sin
    # notas: D3 bloquea la re-ejecución.
    export["solicitudes"][0]["notas"] = None
    db_session.get(SolicitudSupresionDatos, solicitud_id).notas = None
    _crear_pago_pendiente(db_session, persona)
    db_session.commit()

    resultados = reaplicador.reaplicar_supresiones(db_session, export, admin.id)

    db_session.expire_all()
    assert "fallo" in resultados[0]
    assert "pagos pendientes" in resultados[0]["fallo"]
    assert reaplicador._hubo_fallos(resultados)
    assert db_session.get(Persona, persona.id).nombres == "Ana"
    assert db_session.get(SolicitudSupresionDatos, solicitud_id).estado == "APROBADA"
    # El gate del CLI es exactamente este predicado: con fallos, exit != 0 y
    # el runbook no permite reabrir el sistema.
    assert reaplicador._hubo_fallos(resultados)
