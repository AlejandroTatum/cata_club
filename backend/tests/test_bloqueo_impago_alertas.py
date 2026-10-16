"""Avisos del bloqueo por impago (#1768, S7): el aviso de mora del día 1 anuncia
el bloqueo del día 4, y un aviso único de lanzamiento llega a quien ya estaba
vencido cuando el bloqueo entra en vigor.
"""
from datetime import timedelta

import pytest

import app.infraestructura.tareas.alertas_tareas as alertas_mod
from app.dominio.enums import EstadoMembresia, EstadoPago, TipoNotificacion, TipoPago
from app.dominio.modelos import Notificacion, Pago
from app.dominio.nombre_propio import nombre_completo
from app.dominio.periodicidad import PeriodicidadTarifa
from tests.arnes_bloqueo_impago import agregar_pago, crear_miembro, fijar_lanzamiento
from tests.test_alertas_mora import HOY, _crear_usuario, _mock_envio, sesion_inyectada  # noqa: F401

DIA_1 = TipoNotificacion.MIEMBRESIA_MORA_DIA_1
DIA_8 = TipoNotificacion.MIEMBRESIA_MORA_DIA_8


@pytest.fixture(autouse=True)
def _reloj_y_lanzamiento(monkeypatch):
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    fijar_lanzamiento(monkeypatch)


def _con_usuario(db, dias_vencido, **kwargs):
    persona, membresia = crear_miembro(db, cubierto_hasta=HOY - timedelta(days=dias_vencido), **kwargs)
    _crear_usuario(db, persona, f"socio{persona.id}@cataclub.test")
    db.commit()
    return persona, membresia


def _mensajes(db, persona, tipo=DIA_1) -> list[str]:
    return [
        n.mensaje for n in db.query(Notificacion).filter(
            Notificacion.tipo == tipo, Notificacion.persona_id == persona.id,
        )
    ]


# --- Aviso de mora del día 1 ------------------------------------------------------------------
def test_el_aviso_del_dia_1_anuncia_el_bloqueo_del_dia_4_con_su_fecha(
    db_session, sesion_inyectada, monkeypatch,  # noqa: F811
):
    persona, _ = _con_usuario(db_session, 1)
    llamadas = _mock_envio(monkeypatch)

    alertas_mod.alertar_mora_diaria()

    [mensaje] = _mensajes(db_session, persona)
    # `fecha_fin` = 14/06 es EXCLUSIVA: el último día cubierto fue el 13/06. La gracia
    # llega al 17/06 y el bloqueo empieza el 18/06 (esas fechas no cambian).
    assert "Tu membresía venció el 13/06/2029" in mensaje
    assert "18/06/2029" in mensaje and "día 4" in mensaje
    assert "18/06/2029" in llamadas[0]["cuerpo_texto"]


def test_si_el_bloqueo_ya_empezo_el_aviso_del_dia_1_lo_dice(db_session, sesion_inyectada, monkeypatch):  # noqa: F811
    persona, _ = _con_usuario(db_session, 5)  # recuperación de una corrida perdida: ya es el día 5
    _mock_envio(monkeypatch)

    alertas_mod.alertar_mora_diaria()

    [mensaje] = _mensajes(db_session, persona)
    assert "no puedes registrar asistencia" in mensaje
    assert "día 4" not in mensaje


def test_el_aviso_del_dia_1_cuenta_la_gracia_desde_el_lanzamiento(db_session, sesion_inyectada, monkeypatch):  # noqa: F811
    fijar_lanzamiento(monkeypatch, HOY)  # lanzamiento hoy: quien venció antes cuenta desde hoy
    persona, _ = _con_usuario(db_session, 2)
    _mock_envio(monkeypatch)

    alertas_mod.alertar_mora_diaria()

    [mensaje] = _mensajes(db_session, persona)
    assert "19/06/2029" in mensaje  # 15/06 + 4 días


def test_con_el_bloqueo_apagado_el_aviso_del_dia_1_conserva_su_texto(db_session, sesion_inyectada, monkeypatch):  # noqa: F811
    fijar_lanzamiento(monkeypatch, None)
    persona, _ = _con_usuario(db_session, 1)
    _mock_envio(monkeypatch)

    alertas_mod.alertar_mora_diaria()

    assert _mensajes(db_session, persona) == [
        "Tu membresía venció el 13/06/2029. Regulariza tu pago para no perder los beneficios."
    ]


def test_el_miembro_gratuito_recibe_el_aviso_del_dia_1_sin_bloqueo(db_session, sesion_inyectada, monkeypatch):  # noqa: F811
    persona, _ = _con_usuario(db_session, 1, gratuidad_familiar=True)
    _mock_envio(monkeypatch)

    alertas_mod.alertar_mora_diaria()

    [mensaje] = _mensajes(db_session, persona)
    assert "día 4" not in mensaje and "bloque" not in mensaje


def test_el_aviso_del_dia_8_no_cambia(db_session, sesion_inyectada, monkeypatch):  # noqa: F811
    persona, _ = _con_usuario(db_session, 8, estado=EstadoMembresia.VENCIDA)
    _mock_envio(monkeypatch)

    alertas_mod.alertar_mora_diaria()

    assert _mensajes(db_session, persona, DIA_8) == [
        "Tu membresía sigue vencida y este es el último aviso automático que recibirás."
    ]


# --- Aviso único de lanzamiento --------------------------------------------------------------------
def _lanzamiento(**kwargs):
    return alertas_mod.avisar_lanzamiento_bloqueo_impago(**kwargs)


def test_el_aviso_de_lanzamiento_llega_a_quien_ya_estaba_vencido(db_session, sesion_inyectada, monkeypatch):  # noqa: F811
    fijar_lanzamiento(monkeypatch, HOY + timedelta(days=7))
    persona, _ = _con_usuario(db_session, 30, estado=EstadoMembresia.VENCIDA)
    llamadas = _mock_envio(monkeypatch)

    resultado = _lanzamiento()

    assert resultado["total_avisos"] == 1
    [mensaje] = _mensajes(db_session, persona)
    assert "Tu membresía venció el 15/05/2029" in mensaje
    assert "26/06/2029" in mensaje  # lanzamiento 22/06 + 4 días
    assert [c["destinatario"] for c in llamadas] == [f"socio{persona.id}@cataclub.test"]


def test_el_aviso_de_lanzamiento_de_un_menor_va_a_su_representante_con_el_nombre(
    db_session, sesion_inyectada, monkeypatch,  # noqa: F811
):
    representante, _ = crear_miembro(
        db_session, cubierto_hasta=None, estado=EstadoMembresia.INACTIVA, nombres="Rita",
    )
    _crear_usuario(db_session, representante, "rita@cataclub.test")
    hijo, _ = crear_miembro(
        db_session, cubierto_hasta=HOY - timedelta(days=20), representante=representante, nombres="Nino",
    )
    db_session.commit()
    llamadas = _mock_envio(monkeypatch)

    _lanzamiento()

    [mensaje] = _mensajes(db_session, representante)
    assert mensaje.startswith("Para Nino")
    assert _mensajes(db_session, hijo) == []
    assert [c["destinatario"] for c in llamadas] == ["rita@cataclub.test"]


def test_el_aviso_de_lanzamiento_es_idempotente(db_session, sesion_inyectada, monkeypatch):  # noqa: F811
    persona, _ = _con_usuario(db_session, 20)
    _mock_envio(monkeypatch)

    primero = _lanzamiento()
    segundo = _lanzamiento()

    assert primero["total_avisos"] == 1
    assert segundo["total_avisos"] == 0
    assert len(_mensajes(db_session, persona)) == 1


def test_el_aviso_de_lanzamiento_no_pisa_el_aviso_regular_del_dia_1(db_session, sesion_inyectada, monkeypatch):  # noqa: F811
    persona, _ = _con_usuario(db_session, 1)
    _mock_envio(monkeypatch)

    _lanzamiento()
    alertas_mod.alertar_mora_diaria()

    assert len(_mensajes(db_session, persona)) == 2


def test_el_aviso_de_lanzamiento_con_dry_run_no_escribe_nada(db_session, sesion_inyectada, monkeypatch):  # noqa: F811
    persona, _ = _con_usuario(db_session, 20)
    llamadas = _mock_envio(monkeypatch)

    resultado = _lanzamiento(dry_run=True)

    assert resultado["total_avisos"] == 1
    assert resultado["dry_run"] is True
    assert _mensajes(db_session, persona) == []
    assert llamadas == []


def test_el_aviso_de_lanzamiento_no_sale_con_el_bloqueo_apagado(db_session, sesion_inyectada, monkeypatch):  # noqa: F811
    fijar_lanzamiento(monkeypatch, None)
    persona, _ = _con_usuario(db_session, 20)
    _mock_envio(monkeypatch)

    resultado = _lanzamiento()

    assert resultado["total_avisos"] == 0
    assert _mensajes(db_session, persona) == []


def test_el_aviso_de_lanzamiento_respeta_las_mismas_exenciones_que_el_bloqueo(
    db_session, sesion_inyectada, monkeypatch,  # noqa: F811
):
    _mock_envio(monkeypatch)
    al_dia, _ = _con_usuario(db_session, -5, estado=EstadoMembresia.ACTIVA)
    suspendido, _ = _con_usuario(db_session, 20, estado=EstadoMembresia.SUSPENDIDA)
    gratuito, _ = _con_usuario(db_session, 20, gratuidad_familiar=True)
    semanal, _ = _con_usuario(db_session, 20, periodicidad=PeriodicidadTarifa.SEMANAL)
    inactivo, _ = crear_miembro(db_session, cubierto_hasta=None, estado=EstadoMembresia.INACTIVA)
    pagando, membresia = _con_usuario(db_session, 20)
    agregar_pago(
        db_session, pagando, membresia, EstadoPago.PENDIENTE_VALIDACION,
        tipo_pago=TipoPago.TRANSFERENCIA, con_voucher=True,
        fecha_inicio=HOY, fecha_fin=HOY + timedelta(days=30),
    )
    db_session.commit()

    resultado = _lanzamiento()

    assert resultado["total_avisos"] == 0
    for persona in (al_dia, suspendido, gratuito, semanal, inactivo, pagando):
        assert _mensajes(db_session, persona) == []


def test_el_aviso_de_lanzamiento_dice_que_el_bloqueo_ya_rige_si_ya_paso_la_gracia(
    db_session, sesion_inyectada, monkeypatch,  # noqa: F811
):
    persona, _ = _con_usuario(db_session, 40)
    _mock_envio(monkeypatch)

    _lanzamiento()

    [mensaje] = _mensajes(db_session, persona)
    assert "no puedes registrar asistencia" in mensaje


# --- Aviso de lanzamiento: un aviso por jugador, no por responsable (#1779, S9) ---------------
def _familia(db, *, vencidos, al_dia=()):
    """Un representante con usuario y un hijo por nombre: `vencidos` ya vencidos
    hace 20 días, `al_dia` cubiertos. Devuelve (representante, {nombre: membresía})."""
    representante, _ = crear_miembro(
        db, cubierto_hasta=None, estado=EstadoMembresia.INACTIVA, nombres="Rita",
    )
    _crear_usuario(db, representante, "rita@cataclub.test")
    hijos = {}
    for nombre in vencidos:
        _, hijos[nombre] = crear_miembro(
            db, cubierto_hasta=HOY - timedelta(days=20), representante=representante, nombres=nombre,
        )
    for nombre in al_dia:
        _, hijos[nombre] = crear_miembro(
            db, cubierto_hasta=HOY + timedelta(days=10), estado=EstadoMembresia.ACTIVA,
            representante=representante, nombres=nombre,
        )
    db.commit()
    return representante, hijos


def _vencer(db, membresia):
    """El hijo que estaba al día pasa a estar vencido hace 20 días."""
    for pago in db.query(Pago).filter(Pago.membresia_id == membresia.id):
        pago.fecha_inicio, pago.fecha_fin = HOY - timedelta(days=50), HOY - timedelta(days=20)
    membresia.estado = EstadoMembresia.VENCIDA
    db.commit()


def _foto_de_avisos(db, persona):
    return sorted(
        (n.id, n.mensaje, n.entidad_relacionada_id, n.leida)
        for n in db.query(Notificacion).filter(
            Notificacion.tipo == DIA_1, Notificacion.persona_id == persona.id,
        )
    )


def test_un_segundo_hijo_que_vence_despues_recibe_su_aviso_y_el_primero_no_se_repite(
    db_session, sesion_inyectada, monkeypatch,  # noqa: F811
):
    representante, hijos = _familia(db_session, vencidos=["Nino"], al_dia=["Nina"])
    llamadas = _mock_envio(monkeypatch)
    assert _lanzamiento()["total_avisos"] == 1
    [aviso_de_nino] = _foto_de_avisos(db_session, representante)
    _vencer(db_session, hijos["Nina"])

    resultado = _lanzamiento()

    assert [a["membresia_id"] for a in resultado["avisos"]] == [hijos["Nina"].id]
    avisos = _foto_de_avisos(db_session, representante)
    assert aviso_de_nino in avisos  # el primero queda intacto
    assert [m for _, m, _, _ in avisos if m.startswith("Para Nino")] == [aviso_de_nino[1]]
    assert len([m for _, m, _, _ in avisos if m.startswith("Para Nina")]) == 1
    assert len(avisos) == 2
    assert len(llamadas) == 2  # un correo por aviso, ninguno repetido


def test_un_responsable_con_dos_hijos_vencidos_recibe_un_aviso_por_hijo_y_no_se_repiten(
    db_session, sesion_inyectada, monkeypatch,  # noqa: F811
):
    representante, _ = _familia(db_session, vencidos=["Nino", "Nina"])
    _mock_envio(monkeypatch)

    primero = _lanzamiento()
    antes = _foto_de_avisos(db_session, representante)
    segundo = _lanzamiento()

    assert primero["total_avisos"] == 2
    assert segundo["total_avisos"] == 0
    assert _foto_de_avisos(db_session, representante) == antes
    assert len(antes) == 2


def _aviso_heredado(db, persona, mensaje):
    """Fila con el formato que el aviso de lanzamiento ya dejó en producción:
    `MIEMBRESIA_MORA_DIA_1` del responsable, sin entidad relacionada."""
    db.add(Notificacion(tipo=DIA_1, mensaje=mensaje, persona_id=persona.id, entidad_relacionada_id=None))
    db.commit()


def _aviso_heredado_de_un_hijo(db, representante, membresia):
    hijo = membresia.persona
    _aviso_heredado(
        db, representante,
        f"Para {nombre_completo(hijo.nombres, hijo.apellidos)}: Tu membresía venció el 26/05/2029. "
        "Tienes hasta el 25/06/2029 para regularizar tu pago.",
    )


def test_un_aviso_heredado_del_responsable_cuenta_como_avisado_para_ese_hijo(
    db_session, sesion_inyectada, monkeypatch,  # noqa: F811
):
    representante, hijos = _familia(db_session, vencidos=["Nino"])
    _aviso_heredado_de_un_hijo(db_session, representante, hijos["Nino"])
    antes = _foto_de_avisos(db_session, representante)
    llamadas = _mock_envio(monkeypatch)

    resultado = _lanzamiento()

    assert resultado["total_avisos"] == 0
    assert _foto_de_avisos(db_session, representante) == antes
    assert llamadas == []


def test_el_aviso_heredado_de_un_hijo_no_cubre_a_otro_hijo_del_mismo_responsable(
    db_session, sesion_inyectada, monkeypatch,  # noqa: F811
):
    representante, hijos = _familia(db_session, vencidos=["Nino", "Nina"])
    _aviso_heredado_de_un_hijo(db_session, representante, hijos["Nino"])
    _mock_envio(monkeypatch)

    resultado = _lanzamiento()

    assert [a["membresia_id"] for a in resultado["avisos"]] == [hijos["Nina"].id]
    mensajes = _mensajes(db_session, representante)
    assert len(mensajes) == 2
    assert sum(m.startswith("Para Nino") for m in mensajes) == 1
    assert sum(m.startswith("Para Nina") for m in mensajes) == 1


def test_un_aviso_heredado_de_un_adulto_sobre_su_propia_membresia_no_se_repite(
    db_session, sesion_inyectada, monkeypatch,  # noqa: F811
):
    persona, _ = _con_usuario(db_session, 20)
    _aviso_heredado(db_session, persona, "Tu membresía venció el 26/05/2029. Tienes hasta el 25/06/2029.")
    antes = _foto_de_avisos(db_session, persona)
    llamadas = _mock_envio(monkeypatch)

    resultado = _lanzamiento()

    assert resultado["total_avisos"] == 0
    assert _foto_de_avisos(db_session, persona) == antes
    assert llamadas == []


def test_el_aviso_regular_con_pago_de_un_responsable_no_cuenta_como_aviso_de_lanzamiento(
    db_session, sesion_inyectada, monkeypatch,  # noqa: F811
):
    representante, hijos = _familia(db_session, vencidos=["Nino"])
    pago = db_session.query(Pago).filter(Pago.membresia_id == hijos["Nino"].id).one()
    db_session.add(Notificacion(
        tipo=DIA_1, mensaje="Para Nino: Tu membresía venció.",
        persona_id=representante.id, entidad_relacionada_id=pago.id,
    ))
    db_session.commit()
    _mock_envio(monkeypatch)

    resultado = _lanzamiento()

    assert resultado["total_avisos"] == 1


# --- Aviso de mora del día 1: copias de las exenciones (#1779, S8) ----------------------------
COPIA_SIN_BLOQUEO = "Tu membresía venció el 13/06/2029. Regulariza tu pago para no perder los beneficios."


def test_con_el_bloqueo_apagado_el_aviso_del_dia_1_llega_con_la_copia_sin_bloqueo_tambien_por_correo(
    db_session, sesion_inyectada, monkeypatch,  # noqa: F811
):
    fijar_lanzamiento(monkeypatch, None)
    persona, _ = _con_usuario(db_session, 1)
    llamadas = _mock_envio(monkeypatch)

    alertas_mod.alertar_mora_diaria()

    assert _mensajes(db_session, persona) == [COPIA_SIN_BLOQUEO]
    assert [COPIA_SIN_BLOQUEO in c["cuerpo_texto"] for c in llamadas] == [True]


def test_el_miembro_gratuito_de_la_familia_recibe_la_copia_sin_bloqueo_aunque_el_bloqueo_este_activo(
    db_session, sesion_inyectada, monkeypatch,  # noqa: F811
):
    persona, _ = _con_usuario(db_session, 1, gratuidad_familiar=True)
    llamadas = _mock_envio(monkeypatch)

    alertas_mod.alertar_mora_diaria()

    assert _mensajes(db_session, persona) == [COPIA_SIN_BLOQUEO]
    assert [COPIA_SIN_BLOQUEO in c["cuerpo_texto"] for c in llamadas] == [True]
    assert all("registrar asistencia" not in c["cuerpo_texto"] for c in llamadas)


def test_el_miembro_gratuito_ya_pasada_la_gracia_tampoco_recibe_texto_de_bloqueo(
    db_session, sesion_inyectada, monkeypatch,  # noqa: F811
):
    persona, _ = _con_usuario(db_session, 6, gratuidad_familiar=True)
    _mock_envio(monkeypatch)

    alertas_mod.alertar_mora_diaria()

    assert _mensajes(db_session, persona) == [
        "Tu membresía venció el 08/06/2029. Regulariza tu pago para no perder los beneficios."
    ]


# --- Aviso de lanzamiento: el dedup no depende del nombre del hijo (#1787-f) ------------------
def test_renombrar_a_un_hijo_entre_corridas_no_reenvia_su_aviso(
    db_session, sesion_inyectada, monkeypatch,  # noqa: F811
):
    representante, hijos = _familia(db_session, vencidos=["Nino"])
    llamadas = _mock_envio(monkeypatch)
    assert _lanzamiento()["total_avisos"] == 1
    antes = _foto_de_avisos(db_session, representante)
    hijos["Nino"].persona.nombres = "Ninito"
    db_session.commit()

    resultado = _lanzamiento()

    assert resultado["total_avisos"] == 0
    assert _foto_de_avisos(db_session, representante) == antes
    assert len(llamadas) == 1


def test_renombrar_a_un_hijo_no_le_quita_el_aviso_a_su_hermano(
    db_session, sesion_inyectada, monkeypatch,  # noqa: F811
):
    representante, hijos = _familia(db_session, vencidos=["Nino"], al_dia=["Nina"])
    _mock_envio(monkeypatch)
    _lanzamiento()
    hijos["Nino"].persona.nombres = "Ninito"
    _vencer(db_session, hijos["Nina"])

    resultado = _lanzamiento()

    assert [a["membresia_id"] for a in resultado["avisos"]] == [hijos["Nina"].id]
    assert len(_mensajes(db_session, representante)) == 2


def test_la_marca_del_aviso_de_un_hijo_no_choca_con_el_pago_de_ese_mismo_id(
    db_session, sesion_inyectada, monkeypatch,  # noqa: F811
):
    """La marca por hijo no puede coincidir con el id de un pago: la dedup del
    aviso regular de día 1 es `(tipo, responsable, pago_id)`."""
    representante, hijos = _familia(db_session, vencidos=["Nino"])
    _mock_envio(monkeypatch)
    _lanzamiento()

    marcas = [e for _, _, e, _ in _foto_de_avisos(db_session, representante)]

    assert marcas and all(e is None or e < 0 for e in marcas)


def test_el_feed_del_representante_muestra_cada_aviso_marcado_por_hijo_sin_ocultar_ninguno(
    db_session, sesion_inyectada, monkeypatch,  # noqa: F811
):
    """Nada deduplica ni enlaza por `entidad_relacionada_id` negativo: el feed
    (`NotificacionServicio`) muestra las dos filas y devuelve la marca tal cual."""
    from app.servicios_negocio.notificacion_servicio import NotificacionServicio

    representante, hijos = _familia(db_session, vencidos=["Nino", "Nina"])
    _mock_envio(monkeypatch)
    _lanzamiento()

    items, total = NotificacionServicio(db_session).listar_para_persona_y_hijos(representante.id)

    assert total == 2
    assert sorted(i.entidad_relacionada_id for i in items) == sorted(
        alertas_mod._marca_de_jugador(h.persona) for h in hijos.values()
    )
    assert NotificacionServicio(db_session).contar_no_leidas(representante.id, es_representante=True) == 2
