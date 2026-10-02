"""Presencia "conectados ahora" y puerta de franja (issue #1314).

La presencia vive en Redis (un sorted set por rol y uno global, score = último
instante visto) y se toca a lo sumo UNA vez por minuto y usuario, desde la
dependencia de autenticación. El mismo toque decide, con un `SET NX`, si es
la primera petición del usuario en la franja de 2 h del club: solo entonces
se escribe `actividad_usuario`.
"""
from datetime import datetime, timedelta, timezone

import pytest

from app.infraestructura import presencia
from app.seguridad.gestor_auth import GestorAutenticacion
from tests.fabricas_auth import crear_usuario_auth
from tests.redis_falso import RedisFalso

AHORA = datetime(2026, 10, 1, 20, 30, tzinfo=timezone.utc)  # 15:30 del club, franja 7


@pytest.fixture()
def redis_falso(monkeypatch):
    falso = RedisFalso()
    monkeypatch.setattr(presencia, "_cliente_redis", falso)
    presencia.reiniciar_estado_local()
    return falso


def test_primer_toque_es_primera_vez_en_la_franja_y_hace_un_solo_viaje(redis_falso):
    primera = presencia.tocar(7, ["ALUMNO"], AHORA)

    assert primera is True
    assert redis_falso.viajes == 1


def test_toques_dentro_del_minuto_no_tocan_redis(redis_falso):
    presencia.tocar(7, ["ALUMNO"], AHORA)
    viajes = redis_falso.viajes

    for segundos in (1, 20, 59):
        assert presencia.tocar(7, ["ALUMNO"], AHORA + timedelta(seconds=segundos)) is False

    assert redis_falso.viajes == viajes


def test_pasado_el_minuto_toca_otra_vez_pero_no_es_primera_vez_de_la_franja(redis_falso):
    presencia.tocar(7, ["ALUMNO"], AHORA)

    segundo = presencia.tocar(7, ["ALUMNO"], AHORA + timedelta(seconds=61))

    assert segundo is False
    assert redis_falso.viajes == 2


def test_cambio_de_franja_vuelve_a_ser_primera_vez_aunque_no_pase_un_minuto(redis_falso):
    # 16:59:30 del club (franja 8 empieza 16:00... usamos el borde 15:59:30 -> 16:00:10).
    antes = datetime(2026, 10, 1, 20, 59, 30, tzinfo=timezone.utc)  # 15:59:30, franja 7
    despues = antes + timedelta(seconds=40)  # 16:00:10, franja 8
    presencia.tocar(7, ["ALUMNO"], antes)

    assert presencia.tocar(7, ["ALUMNO"], despues) is True


def test_la_puerta_de_franja_es_compartida_entre_procesos(redis_falso):
    presencia.tocar(7, ["ALUMNO"], AHORA)
    presencia.reiniciar_estado_local()  # otro worker / reinicio: memoria local vacía

    assert presencia.tocar(7, ["ALUMNO"], AHORA + timedelta(minutes=5)) is False


def test_contar_devuelve_total_y_por_rol_dentro_de_los_ultimos_5_minutos(redis_falso):
    presencia.tocar(1, ["ALUMNO"], AHORA)
    presencia.tocar(2, ["ALUMNO"], AHORA)
    presencia.tocar(3, ["REPRESENTANTE"], AHORA - timedelta(minutes=4))
    presencia.tocar(4, ["ENTRENADOR"], AHORA - timedelta(minutes=6))  # fuera de ventana
    presencia.tocar(5, ["ADMINISTRADOR"], AHORA)

    conteo = presencia.contar(AHORA)

    assert conteo == {
        "total": 4,
        "por_rol": {"ALUMNO": 2, "ENTRENADOR": 0, "REPRESENTANTE": 1, "ADMINISTRADOR": 1},
    }


def test_un_toque_recorta_las_entradas_vencidas(redis_falso):
    presencia.tocar(1, ["ALUMNO"], AHORA - timedelta(minutes=30))

    presencia.tocar(2, ["ALUMNO"], AHORA)

    assert set(redis_falso.zsets[presencia.CLAVE_TODOS]) == {"2"}


def test_redis_caido_no_lanza_y_la_puerta_cae_a_la_memoria_local(monkeypatch):
    caido = RedisFalso(falla=True)
    monkeypatch.setattr(presencia, "_cliente_redis", caido)
    presencia.reiniciar_estado_local()

    assert presencia.tocar(7, ["ALUMNO"], AHORA) is True
    assert presencia.tocar(7, ["ALUMNO"], AHORA + timedelta(minutes=5)) is False
    assert presencia.contar(AHORA) is None


def test_la_dependencia_de_autenticacion_toca_la_presencia_una_vez_por_minuto(
    client_sin_token, db_session, redis_falso, monkeypatch,
):
    usuario = crear_usuario_auth(db_session)
    registrados: list[int] = []
    monkeypatch.setattr(presencia, "registrar_primera_de_franja", registrados.append)
    access = GestorAutenticacion.crear_token_acceso(
        {"sub": usuario.correo, "persona_id": usuario.persona_id, "roles": ["ALUMNO"]},
        version_sesion=usuario.version_sesion,
    )
    cabeceras = {"Authorization": f"Bearer {access}"}

    for _ in range(3):
        assert client_sin_token.get("/api/v1/auth/me", headers=cabeceras).status_code == 200

    assert redis_falso.viajes == 1
    assert registrados == [usuario.id]
    assert set(redis_falso.zsets[presencia.CLAVE_TODOS]) == {str(usuario.id)}
