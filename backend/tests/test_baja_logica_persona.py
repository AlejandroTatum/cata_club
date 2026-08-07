"""
Baja LÓGICA de una Persona (reemplaza el borrado duro).

Contexto de la decisión de producto: quien deja el club se DESACTIVA, nunca
se borra. El `DELETE /personas/{persona_id}` anterior destruía, junto con la
fila, el historial de asistencias, los pagos y la ficha médica -- registros
que un club que cobra dinero está obligado a conservar. En su lugar existe
`PATCH /personas/{persona_id}/estado`, hermano exacto del ya existente
`PATCH /personas/{persona_id}/cuenta/estado` (que gobierna el flag del
`Usuario`, no el de la `Persona`).

Deliberadamente NO se reutiliza el verbo DELETE para una baja lógica: este
proyecto acaba de pagar el costo de un botón "crear horario" que no creaba
ningún horario, y un DELETE que no borra es exactamente la misma mentira.
"""
from datetime import date, datetime, time, timezone
from decimal import Decimal

from fastapi.testclient import TestClient

from app.dominio.enums import (
    Categoria, DiaSemana, EstadoAsistencia, EstadoMembresia, EstadoPago,
    TipoModalidad, TipoNotificacion, TipoPago, TipoRol, TipoSangre,
)
from app.dominio.modelos import (
    Asistencia, FichaMedica, HorarioEntrenamiento, Membresia, NivelRanking,
    Notificacion, Pago, Persona, Ranking, Rol, TipoMembresia, Usuario,
    AlumnoHorario,
)
from app.infraestructura.db import obtener_sesion
from app.seguridad.gestor_auth import GestorAutenticacion
from main import app


# --- Fábricas ---------------------------------------------------------------
def _crear_persona(db_session, cedula: str = "1710034065", nombres: str = "Ana",
                   apellidos: str = "Vega") -> Persona:
    persona = Persona(
        nombres=nombres, apellidos=apellidos, cedula=cedula,
        fecha_nacimiento=date(1990, 1, 1), telefono="0990000000",
    )
    db_session.add(persona)
    db_session.commit()
    db_session.refresh(persona)
    return persona


def _crear_usuario(db_session, persona: Persona, tipo_rol: TipoRol = TipoRol.ALUMNO,
                   contrasenia: str = "Secreta123") -> Usuario:
    rol = Rol(tipo_rol=tipo_rol, descripcion=tipo_rol.value)
    usuario = Usuario(
        correo=f"u{persona.cedula}@cataclub.test",
        contrasenia=GestorAutenticacion.obtener_hash_contrasenia(contrasenia),
        persona_id=persona.id, roles=[rol],
    )
    db_session.add(usuario)
    db_session.commit()
    db_session.refresh(usuario)
    return usuario


def _crear_horario(db_session) -> HorarioEntrenamiento:
    horario = HorarioEntrenamiento(
        categoria=Categoria.JUVENIL, dia_semana=DiaSemana.LUNES,
        hora_inicio=time(17, 0), hora_fin=time(18, 0),
    )
    db_session.add(horario)
    db_session.commit()
    db_session.refresh(horario)
    return horario


def _crear_historial_completo(db_session, persona: Persona) -> dict:
    """Siembra asistencia + membresía/pago + ficha médica para `persona`.
    Es exactamente el historial que el borrado duro destruía."""
    horario = _crear_horario(db_session)
    asistencia = Asistencia(
        fecha_entrenamiento=date(2029, 3, 3), estado=EstadoAsistencia.PRESENTE,
        persona_id=persona.id, horario_id=horario.id,
    )
    tipo = TipoMembresia(
        categoria="JUVENIL",
        precio=Decimal("30.00"), modalidad=TipoModalidad.MENSUAL,
    )
    db_session.add_all([asistencia, tipo])
    db_session.flush()
    membresia = Membresia(
        estado=EstadoMembresia.ACTIVA, monto_aplicado=Decimal("30.00"),
        fecha_activacion=datetime(2029, 3, 1, tzinfo=timezone.utc),
        persona_id=persona.id, tipo_membresia_id=tipo.id,
    )
    db_session.add(membresia)
    db_session.flush()
    pago = Pago(
        monto=Decimal("30.00"), estado_pago=EstadoPago.APROBADO,
        tipo_pago=TipoPago.EFECTIVO, fecha_inicio=date(2029, 3, 1),
        fecha_fin=date(2029, 3, 31), persona_id=persona.id, membresia_id=membresia.id,
    )
    ficha = FichaMedica(tipo_sangre=TipoSangre.O_POSITIVO, persona_id=persona.id)
    db_session.add_all([pago, ficha])
    db_session.commit()
    return {"horario_id": horario.id, "asistencia_id": asistencia.id, "pago_id": pago.id}


def _desactivar(client, persona_id: int):
    return client.patch(f"/api/v1/personas/{persona_id}/estado", json={"activo": False})


def _activar(client, persona_id: int):
    return client.patch(f"/api/v1/personas/{persona_id}/estado", json={"activo": True})


def _client_como(db_session, persona_id: int, roles: list[str]) -> TestClient:
    """Cliente autenticado con un `persona_id`/`roles` arbitrarios, mismo
    idiom que `tests/test_ficha_medica_representante.py`. Hace falta porque
    el feed de notificaciones se ramifica según el rol REPRESENTANTE del
    token, y el `client` por defecto es ADMINISTRADOR + ENTRENADOR."""
    def _sesion():
        yield db_session

    app.dependency_overrides[obtener_sesion] = _sesion
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "representante@cataclub.test", "persona_id": persona_id,
        "roles": roles,
    }
    return TestClient(app)


# --- El borrado duro ya no existe -------------------------------------------
def test_ya_no_existe_delete_de_persona(client, db_session):
    """La ruta destructiva se removió: el router ya no la declara, así que
    FastAPI responde 405 (el path existe para PATCH/GET, no para DELETE)."""
    persona = _crear_persona(db_session)

    respuesta = client.delete(f"/api/v1/personas/{persona.id}")

    assert respuesta.status_code == 405


# --- Desactivar / reactivar --------------------------------------------------
def test_desactivar_persona_activa_baja_la_bandera(client, db_session):
    persona = _crear_persona(db_session)

    respuesta = _desactivar(client, persona.id)

    assert respuesta.status_code == 200
    assert respuesta.json()["activo"] is False
    db_session.expire_all()
    assert db_session.get(Persona, persona.id).activo is False


def test_persona_nace_activa(client, db_session):
    persona = _crear_persona(db_session)

    respuesta = client.get(f"/api/v1/personas/{persona.id}")

    assert respuesta.status_code == 200
    assert respuesta.json()["activo"] is True


def test_desactivar_persona_tambien_desactiva_su_usuario(client, db_session):
    persona = _crear_persona(db_session)
    usuario = _crear_usuario(db_session, persona)

    respuesta = _desactivar(client, persona.id)

    assert respuesta.status_code == 200
    db_session.expire_all()
    assert db_session.get(Usuario, usuario.id).activo is False


def test_desactivar_persona_sin_usuario_no_revienta(client, db_session):
    """Un menor inscrito por su representante no tiene `Usuario` propio: la
    baja no puede depender de que exista uno."""
    persona = _crear_persona(db_session)

    respuesta = _desactivar(client, persona.id)

    assert respuesta.status_code == 200
    assert respuesta.json()["activo"] is False


def test_persona_desactivada_no_puede_iniciar_sesion(client, db_session):
    persona = _crear_persona(db_session)
    usuario = _crear_usuario(db_session, persona, contrasenia="Secreta123")
    _desactivar(client, persona.id)

    respuesta = client.post(
        "/api/v1/auth/login",
        data={"username": usuario.correo, "password": "Secreta123"},
    )

    assert respuesta.status_code == 401


def test_reactivar_persona_sube_la_bandera(client, db_session):
    persona = _crear_persona(db_session)
    _desactivar(client, persona.id)

    respuesta = _activar(client, persona.id)

    assert respuesta.status_code == 200
    assert respuesta.json()["activo"] is True


def test_reactivar_persona_no_reactiva_la_cuenta(client, db_session):
    """Decisión explícita: el estado de la CUENTA es una preocupación
    separada del estado de MEMBRESÍA. Reactivar a alguien en el club no le
    devuelve solo el acceso al sistema -- eso se hace, si corresponde, con
    `PATCH /personas/{id}/cuenta/estado`."""
    persona = _crear_persona(db_session)
    usuario = _crear_usuario(db_session, persona)
    _desactivar(client, persona.id)

    _activar(client, persona.id)

    db_session.expire_all()
    assert db_session.get(Usuario, usuario.id).activo is False


def test_desactivar_dos_veces_es_idempotente(client, db_session):
    persona = _crear_persona(db_session)
    _desactivar(client, persona.id)

    respuesta = _desactivar(client, persona.id)

    assert respuesta.status_code == 200
    assert respuesta.json()["activo"] is False


def test_reactivar_dos_veces_es_idempotente(client, db_session):
    persona = _crear_persona(db_session)
    _desactivar(client, persona.id)
    _activar(client, persona.id)

    respuesta = _activar(client, persona.id)

    assert respuesta.status_code == 200
    assert respuesta.json()["activo"] is True


def test_desactivar_persona_inexistente_da_404(client):
    respuesta = _desactivar(client, 999999)

    assert respuesta.status_code == 404


def test_desactivar_requiere_administrador(client_sin_permisos, db_session):
    persona = _crear_persona(db_session)

    respuesta = _desactivar(client_sin_permisos, persona.id)

    assert respuesta.status_code == 403


def test_no_se_puede_desactivar_al_ultimo_administrador(client, db_session):
    """Misma barrera anti-bloqueo que `PATCH /cuenta/estado`: desactivar a la
    persona del último administrador activo dejaría al club sin ninguna vía
    de administración."""
    persona = _crear_persona(db_session)
    _crear_usuario(db_session, persona, tipo_rol=TipoRol.ADMINISTRADOR)

    respuesta = _desactivar(client, persona.id)

    assert respuesta.status_code == 400
    assert "administrador" in respuesta.json()["message"].lower()


# --- El punto entero de la decisión: el historial sobrevive -----------------
def test_historial_sobrevive_a_la_desactivacion(client, db_session):
    """Asistencias, pagos y ficha médica siguen existiendo y siendo legibles
    por un administrador después de dar de baja a la persona. Esto es lo que
    el borrado duro destruía."""
    persona = _crear_persona(db_session, cedula="1710034065")
    _crear_historial_completo(db_session, persona)

    assert _desactivar(client, persona.id).status_code == 200

    asistencias = client.get(f"/api/v1/asistencias/persona/{persona.id}")
    assert asistencias.status_code == 200
    assert len(asistencias.json()) == 1

    pagos = client.get(f"/api/v1/membresias/pagos/persona/{persona.id}")
    assert pagos.status_code == 200
    assert len(pagos.json()) == 1

    ficha = client.get(f"/api/v1/fichas-medicas/persona/{persona.id}")
    assert ficha.status_code == 200
    assert ficha.json()["personaId"] == persona.id


# --- Listados OPERATIVOS: la persona desactivada desaparece -----------------
# El test del selector de entrenadores murió con `GET /personas/entrenadores`
# (issue #13): sin relación entrenador–horario no hay selector que filtrar.


def test_desactivada_desaparece_del_autocomplete_de_busqueda(client, db_session):
    persona = _crear_persona(db_session, nombres="Zoraida", apellidos="Quintana")

    _desactivar(client, persona.id)

    respuesta = client.get("/api/v1/personas/buscar", params={"q": "Zoraida"})
    assert respuesta.status_code == 200
    assert persona.id not in [p["id"] for p in respuesta.json()]


def test_desactivada_desaparece_de_los_representados(client, db_session):
    representante = _crear_persona(db_session, cedula="1710034065")
    hijo = _crear_persona(db_session, cedula="1710034073", nombres="Beto")
    hijo.representante_id = representante.id
    db_session.commit()

    _desactivar(client, hijo.id)

    respuesta = client.get(f"/api/v1/personas/{representante.id}/representados")
    assert respuesta.status_code == 200
    assert hijo.id not in [p["id"] for p in respuesta.json()]


def test_desactivada_desaparece_del_feed_de_notificaciones_del_representante(
    client, db_session
):
    """El feed combinado del representante (`GET /ranking/notificaciones/mias`
    cuando el token trae REPRESENTANTE) leía la relación ORM cruda
    `persona.representados`, que no se puede filtrar: las notificaciones de un
    dependiente dado de baja le seguían llegando para siempre, aunque el
    dependiente ya no aparezca en ningún otro listado del portal."""
    representante = _crear_persona(db_session, cedula="1710034065")
    hijo = _crear_persona(db_session, cedula="1710034073", nombres="Beto")
    hijo.representante_id = representante.id
    db_session.add_all([
        Notificacion(
            tipo=TipoNotificacion.PAGO_APROBADO,
            mensaje="Pago de Beto aprobado", persona_id=hijo.id,
        ),
        Notificacion(
            tipo=TipoNotificacion.PAGO_APROBADO,
            mensaje="Pago del representante aprobado", persona_id=representante.id,
        ),
    ])
    db_session.commit()

    _desactivar(client, hijo.id)

    with _client_como(db_session, representante.id, ["REPRESENTANTE"]) as c:
        respuesta = c.get("/api/v1/ranking/notificaciones/mias")
    app.dependency_overrides.clear()
    assert respuesta.status_code == 200
    mensajes = [n["mensaje"] for n in respuesta.json()]
    # El DTO no expone `persona_id`; el mensaje es el discriminante.
    assert "Pago de Beto aprobado" not in mensajes
    # Control positivo: el feed sigue trayendo lo propio (si el test pasara
    # por devolver una lista vacía, no probaría nada).
    assert "Pago del representante aprobado" in mensajes


def test_desactivada_desaparece_de_la_nomina_del_horario(client, db_session):
    horario = _crear_horario(db_session)
    alumno = _crear_persona(db_session, cedula="1710034065")
    db_session.add(AlumnoHorario(persona_id=alumno.id, horario_id=horario.id))
    db_session.commit()

    _desactivar(client, alumno.id)

    respuesta = client.get(f"/api/v1/asistencias/horarios/{horario.id}/alumnos")
    assert respuesta.status_code == 200
    assert alumno.id not in [a["personaId"] for a in respuesta.json()["items"]]


def test_desactivada_desaparece_del_roster_de_alumnos_con_nivel(client, db_session):
    alumno = _crear_persona(db_session, cedula="1710034065")
    _crear_usuario(db_session, alumno, tipo_rol=TipoRol.ALUMNO)

    _desactivar(client, alumno.id)

    respuesta = client.get("/api/v1/ranking/alumnos-con-nivel")
    assert respuesta.status_code == 200
    assert alumno.id not in [a["personaId"] for a in respuesta.json()["items"]]


def test_desactivada_desaparece_de_la_tabla_del_nivel(client, db_session):
    nivel = NivelRanking(numero_nivel=1, nombre="Nivel 1")
    alumno = _crear_persona(db_session, cedula="1710034065")
    db_session.add(nivel)
    db_session.flush()
    db_session.add(Ranking(persona_id=alumno.id, nivel_ranking_id=nivel.id))
    db_session.commit()

    _desactivar(client, alumno.id)

    respuesta = client.get(f"/api/v1/ranking/niveles/{nivel.id}/tabla")
    assert respuesta.status_code == 200
    assert alumno.id not in [r["personaId"] for r in respuesta.json()]


def test_desactivada_desaparece_de_las_asignaciones_de_ranking(client, db_session):
    nivel = NivelRanking(numero_nivel=1, nombre="Nivel 1")
    alumno = _crear_persona(db_session, cedula="1710034065")
    db_session.add(nivel)
    db_session.flush()
    db_session.add(Ranking(persona_id=alumno.id, nivel_ranking_id=nivel.id))
    db_session.commit()

    _desactivar(client, alumno.id)

    respuesta = client.get("/api/v1/ranking/asignaciones")
    assert respuesta.status_code == 200
    assert alumno.id not in [r["personaId"] for r in respuesta.json()["items"]]


# --- Listados ADMINISTRATIVOS: la persona desactivada SIGUE apareciendo -----
def test_desactivada_sigue_en_el_roster_administrativo(client, db_session):
    """Si el listado del panel admin la escondiera, no habría forma humana de
    volver a encontrarla para reactivarla."""
    persona = _crear_persona(db_session)

    _desactivar(client, persona.id)

    respuesta = client.get("/api/v1/personas/")
    assert respuesta.status_code == 200
    fila = next(p for p in respuesta.json()["items"] if p["id"] == persona.id)
    assert fila["activo"] is False


def test_desactivada_sigue_siendo_consultable_por_id(client, db_session):
    persona = _crear_persona(db_session)

    _desactivar(client, persona.id)

    respuesta = client.get(f"/api/v1/personas/{persona.id}")
    assert respuesta.status_code == 200
    assert respuesta.json()["activo"] is False


def test_desactivada_sigue_en_el_reporte_de_nuevos_por_periodo(client, db_session):
    """Reporte histórico: haberse registrado en marzo es un hecho que no deja
    de ser cierto porque la persona se dio de baja en junio."""
    persona = _crear_persona(db_session)

    _desactivar(client, persona.id)

    respuesta = client.get(
        "/api/v1/personas/reportes/nuevos-por-periodo",
        params={"fecha_inicio": "2000-01-01", "fecha_fin": "2100-01-01"},
    )
    assert respuesta.status_code == 200
    assert persona.id in [p["id"] for p in respuesta.json()]
