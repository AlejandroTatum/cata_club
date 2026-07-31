"""
`RankingServicio.listar_alumnos_con_nivel` alimenta el panel de Nivel del
entrenador (`GET /ranking/alumnos-con-nivel`). Traía la nómina de alumnos y
después consultaba el `Ranking` de CADA UNO por separado: N+1 sentencias.

Estos tests fijan el contrato completo del listado, no solo el conteo de
sentencias: los alumnos SIN fila de ranking tienen que seguir apareciendo
(son la columna "Sin nivel asignado" de la pantalla, y un INNER JOIN los
borraría en silencio), el orden de nómina no puede cambiar, y una persona con
varios roles debe aparecer UNA sola vez aunque el JOIN con roles multiplique
filas.
"""
from datetime import date

import pytest
from sqlalchemy import event

from app.dominio.enums import TipoRol
from app.dominio.modelos import NivelRanking, Persona, Ranking, Rol, Usuario
from app.servicios_negocio.ranking_servicio import RankingServicio


def _crear_alumno(db_session, nombres, apellidos, cedula, roles=(TipoRol.ALUMNO,)):
    """Crea Persona + Usuario con los roles dados (por defecto ALUMNO).
    El rol se asigna vía Usuario porque ese es el criterio de "rol asignado"
    que usa `PersonaRepositorio.listar_por_rol`."""
    persona = Persona(
        nombres=nombres, apellidos=apellidos, cedula=cedula,
        fecha_nacimiento=date(2000, 1, 1), telefono="0991234567",
    )
    db_session.add(persona)
    db_session.flush()
    usuario = Usuario(
        correo=f"alumno{cedula}@cataclub.test",
        contrasenia="hash",
        persona_id=persona.id,
        roles=[Rol(tipo_rol=tipo, descripcion=tipo.value) for tipo in roles],
    )
    db_session.add(usuario)
    db_session.commit()
    return persona


def _crear_nivel(db_session, numero_nivel=1, nombre="Elite"):
    nivel = NivelRanking(numero_nivel=numero_nivel, nombre=nombre)
    db_session.add(nivel)
    db_session.commit()
    return nivel


def _asignar_ranking(db_session, persona_id, nivel_id):
    ranking = Ranking(persona_id=persona_id, nivel_ranking_id=nivel_id)
    db_session.add(ranking)
    db_session.commit()
    return ranking


@pytest.fixture()
def contar_selects(db_session):
    """Cuenta las sentencias SELECT ejecutadas dentro del bloque `with`.
    Mismo mecanismo (`after_cursor_execute`) que el guard de N+1 de
    `test_membresia_repositorio.py`."""
    import contextlib

    @contextlib.contextmanager
    def _medir():
        sentencias: list[str] = []

        def _contar(conn, cursor, statement, parameters, context, executemany):
            sentencias.append(statement)

        engine = db_session.get_bind()
        event.listen(engine, "after_cursor_execute", _contar)
        try:
            yield sentencias
        finally:
            event.remove(engine, "after_cursor_execute", _contar)

    return _medir


def test_listar_alumnos_con_nivel_no_incurre_en_n_mas_uno(db_session, contar_selects):
    """El número de sentencias SQL NO puede crecer con la cantidad de alumnos.
    Con la implementación N+1 (un `SELECT ranking` por alumno) esto es
    1 + N; con un OUTER JOIN único es 1."""
    nivel = _crear_nivel(db_session)
    cantidad = 10
    for i in range(cantidad):
        persona = _crear_alumno(
            db_session, nombres=f"Alumno{i}", apellidos=f"Apellido{i:02d}",
            cedula=f"171003{4100 + i}",
        )
        if i % 2 == 0:  # la mitad sin fila de ranking, a propósito
            _asignar_ranking(db_session, persona.id, nivel.id)

    db_session.expire_all()  # fuerza recarga real desde la BD, no la identity map

    with contar_selects() as sentencias:
        resultado, total = RankingServicio(db_session).listar_alumnos_con_nivel()

    assert len(resultado) == cantidad
    assert total == cantidad
    selects = [s for s in sentencias if s.strip().upper().startswith("SELECT")]
    # Exactamente 2, no "pocas": la página se resuelve con un unico OUTER
    # JOIN y el `total` del envelope paginado (issue #7) con un unico COUNT.
    # Ambas son constantes: no crecen con la cantidad de alumnos. Un tope
    # holgado (<= 3) dejaria pasar en verde una regresion a tres consultas
    # -- por ejemplo volver a separar el ranking en un `WHERE persona_id IN
    # (...)` --, que es justo la clase de crecimiento por peticion que este
    # guard existe para impedir.
    assert len(selects) == 2, (
        f"N+1 detectado: {cantidad} alumnos produjeron {len(selects)} SELECTs. "
        f"El listado debe resolverse con un OUTER JOIN para la página y un "
        f"COUNT para el total, no con una consulta de ranking por alumno. "
        f"Sentencias: {selects}"
    )


def test_alumno_sin_ranking_aparece_con_nivel_nulo(db_session):
    """Un alumno sin fila de `Ranking` es un caso legítimo (todavía no fue
    asignado a un grupo). Debe aparecer con `nivel_ranking_id = None` — es
    exactamente la columna "Sin nivel asignado" del panel. Un INNER JOIN lo
    haría desaparecer del roster sin error visible.

    El otro camino al mismo estado es tener fila de `Ranking` pero sin nivel
    (`nivel_ranking_id` NULL): pasa entre que se crea la fila y el entrenador
    asigna el nivel inicial. Desde que se eliminó `esta_en_ranking`, esos dos
    son los ÚNICOS caminos a "sin nivel", y ambos se leen de la misma
    columna."""
    nivel = _crear_nivel(db_session)
    con_ranking = _crear_alumno(
        db_session, "Ana", "Alvarez", "1710034100",
    )
    _asignar_ranking(db_session, con_ranking.id, nivel.id)
    sin_ranking = _crear_alumno(db_session, "Beto", "Benitez", "1710034101")
    # Fila creada pero sin nivel todavía -> también null.
    sin_nivel = _crear_alumno(db_session, "Carla", "Cordova", "1710034102")
    _asignar_ranking(db_session, sin_nivel.id, None)

    resultado, _total = RankingServicio(db_session).listar_alumnos_con_nivel()
    por_persona = {dto.persona_id: dto for dto in resultado}

    assert por_persona[con_ranking.id].nivel_ranking_id == nivel.id
    assert por_persona[sin_ranking.id].nivel_ranking_id is None
    assert por_persona[sin_nivel.id].nivel_ranking_id is None
    assert por_persona[sin_ranking.id].nombres == "Beto"
    assert por_persona[sin_ranking.id].apellidos == "Benitez"


def test_listar_alumnos_con_nivel_respeta_el_orden_de_nomina(db_session):
    """Orden de nómina: apellidos, nombres, id. Los datos se insertan al
    revés a propósito para que el test falle si el ORDER BY se pierde."""
    _crear_alumno(db_session, "Zoe", "Zambrano", "1710034200")
    _crear_alumno(db_session, "Marco", "Molina", "1710034201")
    _crear_alumno(db_session, "Ana", "Alvarez", "1710034202")
    # Homónimos de apellido: desempata por nombres.
    _crear_alumno(db_session, "Bruno", "Molina", "1710034203")

    resultado, _total = RankingServicio(db_session).listar_alumnos_con_nivel()

    assert [(d.apellidos, d.nombres) for d in resultado] == [
        ("Alvarez", "Ana"),
        ("Molina", "Bruno"),
        ("Molina", "Marco"),
        ("Zambrano", "Zoe"),
    ]


def test_persona_con_varios_roles_aparece_una_sola_vez(db_session):
    """El filtro por rol pasa por el JOIN persona-usuario-rol, que multiplica
    filas cuando el usuario tiene más de un rol. La persona debe aparecer
    exactamente una vez."""
    multirol = _crear_alumno(
        db_session, "Diana", "Duarte", "1710034300",
        roles=(TipoRol.ALUMNO, TipoRol.ENTRENADOR, TipoRol.REPRESENTANTE),
    )
    _crear_alumno(db_session, "Eva", "Estrada", "1710034301")
    # Solo entrenador: no debe aparecer nunca.
    _crear_alumno(
        db_session, "Fabio", "Fuentes", "1710034302", roles=(TipoRol.ENTRENADOR,),
    )

    resultado, total = RankingServicio(db_session).listar_alumnos_con_nivel()

    ids = [dto.persona_id for dto in resultado]
    assert ids.count(multirol.id) == 1
    assert len(ids) == 2
    # El COUNT del total deduplica con el mismo criterio (DISTINCT sobre
    # persona): la multirol tampoco puede contarse dos veces.
    assert total == 2
