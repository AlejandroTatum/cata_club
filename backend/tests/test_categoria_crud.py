"""ABM de categorías (docs/archive/fixes/24-abm-categorias.md): el dueño pidió que
crear una categoría cree, en la MISMA operación, la fila de
`categoria_horario` y un `horario_entrenamiento` por cada día marcado --
"quisiera que se cree directo el horario y categoría, no diferentes". Este
archivo cubre las cuatro decisiones documentadas en el fix:

1. `codigo` se deriva de `nombre` y es estable (no cambia en un rename).
2. Quitar un día con asistencias registradas bloquea la edición ENTERA.
3. Cambiar la franja re-deriva las horas de los horarios que quedan.
4. Agregar un día a una categoría con alumnos backfillea su inscripción.
"""
from datetime import time

import pytest

from app.dominio.enums import DiaSemana, EstadoAsistencia
from app.dominio.excepciones import EntidadNoEncontrada, OperacionInvalida
from app.dominio.modelos import CategoriaHorario, CategoriaHorarioDia
from app.servicios_negocio.dtos.asistencia_schemas import (
    AlumnoHorarioCreateDTO, CategoriaCreateDTO, CategoriaUpdateDTO,
)
from app.servicios_negocio.asistencia_servicio import AsistenciaServicio


def _crear_persona_api(client, cedula="1710034065", nombres="Ana"):
    return client.post(
        "/api/v1/personas/",
        json={
            "nombres": nombres, "apellidos": "Torres", "cedula": cedula,
            "fecha_nacimiento": "2010-05-14", "telefono": "0991234567",
        },
    ).json()


# --- Alta atómica ------------------------------------------------------
def test_crear_categoria_crea_categoria_dias_y_horarios_atomicamente(db_session):
    servicio = AsistenciaServicio(db_session)

    categoria = servicio.crear_categoria(CategoriaCreateDTO(
        nombre="Preinfantil", hora_inicio=time(15, 0), hora_fin=time(16, 0),
        dias=[DiaSemana.LUNES, DiaSemana.MIERCOLES],
    ))

    assert categoria.codigo == "PREINFANTIL"
    assert set(categoria.dias) == {DiaSemana.LUNES, DiaSemana.MIERCOLES}

    fila = db_session.get(CategoriaHorario, "PREINFANTIL")
    assert fila is not None
    assert {d.dia_semana for d in fila.dias_permitidos} == {DiaSemana.LUNES, DiaSemana.MIERCOLES}

    horarios = servicio.listar_horarios("PREINFANTIL")
    assert len(horarios) == 2
    assert {h.dia_semana for h in horarios} == {DiaSemana.LUNES, DiaSemana.MIERCOLES}
    assert all(h.hora_inicio == time(15, 0) and h.hora_fin == time(16, 0) for h in horarios)


def test_crear_categoria_deriva_codigo_del_nombre_sin_espacios_ni_acentos(db_session):
    servicio = AsistenciaServicio(db_session)

    categoria = servicio.crear_categoria(CategoriaCreateDTO(
        nombre="Súper Chiquitos", hora_inicio=time(9, 0), hora_fin=time(10, 0),
        dias=[DiaSemana.VIERNES],
    ))

    assert categoria.codigo == "SUPER_CHIQUITOS"


def test_crear_categoria_resuelve_colision_de_codigo_con_sufijo(db_session):
    servicio = AsistenciaServicio(db_session)
    servicio.crear_categoria(CategoriaCreateDTO(
        nombre="Beta", hora_inicio=time(9, 0), hora_fin=time(10, 0), dias=[DiaSemana.LUNES],
    ))

    otra = servicio.crear_categoria(CategoriaCreateDTO(
        nombre="Beta!!", hora_inicio=time(10, 0), hora_fin=time(11, 0), dias=[DiaSemana.MARTES],
    ))

    assert otra.codigo == "BETA_2"


def test_crear_categoria_rechaza_nombre_duplicado(db_session):
    servicio = AsistenciaServicio(db_session)
    servicio.crear_categoria(CategoriaCreateDTO(
        nombre="Preinfantil", hora_inicio=time(9, 0), hora_fin=time(10, 0), dias=[DiaSemana.LUNES],
    ))

    with pytest.raises(OperacionInvalida) as exc_info:
        servicio.crear_categoria(CategoriaCreateDTO(
            nombre="Preinfantil", hora_inicio=time(11, 0), hora_fin=time(12, 0),
            dias=[DiaSemana.MARTES],
        ))
    assert "Preinfantil" in str(exc_info.value)
    # Nada se creó a medias: el segundo intento no dejó una categoria nueva.
    codigos = {c.codigo for c in servicio.listar_categorias()}
    assert "PREINFANTIL_2" not in codigos
    assert len([c for c in codigos if c.startswith("PREINFANTIL")]) == 1


def test_crear_categoria_rechaza_franja_invertida(db_session):
    servicio = AsistenciaServicio(db_session)

    with pytest.raises(OperacionInvalida):
        servicio.crear_categoria(CategoriaCreateDTO(
            nombre="Preinfantil", hora_inicio=time(16, 0), hora_fin=time(15, 0),
            dias=[DiaSemana.LUNES],
        ))


def test_crear_categoria_dia_repetido_en_el_payload_no_duplica_el_horario(db_session):
    """El candado de una sola fila por (categoria, día) sigue valiendo: un
    llamado directo a la API (no la casilla del formulario, que es un Set)
    que repite el mismo día no debe reventar ni crear dos filas."""
    servicio = AsistenciaServicio(db_session)

    categoria = servicio.crear_categoria(CategoriaCreateDTO(
        nombre="Preinfantil", hora_inicio=time(9, 0), hora_fin=time(10, 0),
        dias=[DiaSemana.LUNES, DiaSemana.LUNES],
    ))

    assert len(servicio.listar_horarios(categoria.codigo)) == 1


# --- Edición: franja se re-deriva ---------------------------------------
def test_actualizar_categoria_cambia_franja_re_deriva_horas_de_horarios_existentes(db_session):
    servicio = AsistenciaServicio(db_session)
    categoria = servicio.crear_categoria(CategoriaCreateDTO(
        nombre="Preinfantil", hora_inicio=time(15, 0), hora_fin=time(16, 0),
        dias=[DiaSemana.LUNES, DiaSemana.MIERCOLES],
    ))

    servicio.actualizar_categoria(categoria.codigo, CategoriaUpdateDTO(
        hora_inicio=time(17, 0), hora_fin=time(18, 0),
    ))

    horarios = servicio.listar_horarios(categoria.codigo)
    assert len(horarios) == 2
    assert all(h.hora_inicio == time(17, 0) and h.hora_fin == time(18, 0) for h in horarios)


def test_actualizar_categoria_renombra_sin_tocar_el_codigo(db_session):
    servicio = AsistenciaServicio(db_session)
    categoria = servicio.crear_categoria(CategoriaCreateDTO(
        nombre="Preinfantil", hora_inicio=time(15, 0), hora_fin=time(16, 0),
        dias=[DiaSemana.LUNES],
    ))

    actualizada = servicio.actualizar_categoria(
        categoria.codigo, CategoriaUpdateDTO(nombre="Preinfantil A"),
    )

    assert actualizada.codigo == categoria.codigo
    assert actualizada.label == "Preinfantil A"


def test_actualizar_categoria_rechaza_nombre_duplicado_de_otra_categoria(db_session):
    servicio = AsistenciaServicio(db_session)
    servicio.crear_categoria(CategoriaCreateDTO(
        nombre="Preinfantil", hora_inicio=time(9, 0), hora_fin=time(10, 0), dias=[DiaSemana.LUNES],
    ))
    otra = servicio.crear_categoria(CategoriaCreateDTO(
        nombre="Infantil B", hora_inicio=time(11, 0), hora_fin=time(12, 0), dias=[DiaSemana.MARTES],
    ))

    with pytest.raises(OperacionInvalida):
        servicio.actualizar_categoria(otra.codigo, CategoriaUpdateDTO(nombre="Preinfantil"))


# --- Edición: agregar día backfillea alumnos inscriptos ------------------
def test_actualizar_categoria_agregar_dia_backfillea_alumnos_inscriptos(db_session, client):
    servicio = AsistenciaServicio(db_session)
    categoria = servicio.crear_categoria(CategoriaCreateDTO(
        nombre="Preinfantil", hora_inicio=time(15, 0), hora_fin=time(16, 0),
        dias=[DiaSemana.LUNES],
    ))
    alumno = _crear_persona_api(client)
    horario_lunes = servicio.listar_horarios(categoria.codigo)[0]
    servicio.asignar_alumno_a_horario(
        AlumnoHorarioCreateDTO(persona_id=alumno["id"], horario_id=horario_lunes.id)
    )

    servicio.actualizar_categoria(categoria.codigo, CategoriaUpdateDTO(
        dias=[DiaSemana.LUNES, DiaSemana.MIERCOLES],
    ))

    horarios = {h.dia_semana: h for h in servicio.listar_horarios(categoria.codigo)}
    horario_miercoles = horarios[DiaSemana.MIERCOLES]
    asignaciones = servicio.listar_horarios_por_alumno(alumno["id"])
    assert {a.horario_id for a in asignaciones} == {horario_lunes.id, horario_miercoles.id}


def test_actualizar_categoria_quitar_dia_sin_historial_lo_borra(db_session):
    servicio = AsistenciaServicio(db_session)
    categoria = servicio.crear_categoria(CategoriaCreateDTO(
        nombre="Preinfantil", hora_inicio=time(15, 0), hora_fin=time(16, 0),
        dias=[DiaSemana.LUNES, DiaSemana.MIERCOLES],
    ))

    actualizada = servicio.actualizar_categoria(categoria.codigo, CategoriaUpdateDTO(
        dias=[DiaSemana.LUNES],
    ))

    assert actualizada.dias == [DiaSemana.LUNES]
    assert len(servicio.listar_horarios(categoria.codigo)) == 1
    assert db_session.get(CategoriaHorarioDia, ("PREINFANTIL", DiaSemana.MIERCOLES)) is None


# --- Edición: quitar día con historial bloquea TODO -----------------------
def test_actualizar_categoria_quitar_dia_con_asistencias_bloquea_la_edicion_entera(db_session, client):
    servicio = AsistenciaServicio(db_session)
    categoria = servicio.crear_categoria(CategoriaCreateDTO(
        nombre="Preinfantil", hora_inicio=time(15, 0), hora_fin=time(16, 0),
        dias=[DiaSemana.LUNES, DiaSemana.MIERCOLES],
    ))
    alumno = _crear_persona_api(client)
    horario_lunes = next(h for h in servicio.listar_horarios(categoria.codigo) if h.dia_semana == DiaSemana.LUNES)
    servicio.asignar_alumno_a_horario(
        AlumnoHorarioCreateDTO(persona_id=alumno["id"], horario_id=horario_lunes.id)
    )
    from app.servicios_negocio.dtos.asistencia_schemas import AsistenciaCreateDTO
    servicio.registrar_asistencia(AsistenciaCreateDTO(
        fecha_entrenamiento="2026-08-10", estado=EstadoAsistencia.PRESENTE,
        persona_id=alumno["id"], horario_id=horario_lunes.id,
    ), ["ADMINISTRADOR"], alumno["id"])

    with pytest.raises(OperacionInvalida) as exc_info:
        servicio.actualizar_categoria(categoria.codigo, CategoriaUpdateDTO(
            nombre="Otro nombre", dias=[DiaSemana.MIERCOLES],
        ))
    assert "lunes" in str(exc_info.value)

    # Nada se tocó: ni el nombre, ni los días, ni las horas.
    fila = db_session.get(CategoriaHorario, categoria.codigo)
    assert fila.label == "Preinfantil"
    assert len(servicio.listar_horarios(categoria.codigo)) == 2


# --- Baja de la categoría entera ------------------------------------------
def test_eliminar_categoria_sin_historial_borra_categoria_dias_y_horarios(db_session):
    servicio = AsistenciaServicio(db_session)
    categoria = servicio.crear_categoria(CategoriaCreateDTO(
        nombre="Preinfantil", hora_inicio=time(15, 0), hora_fin=time(16, 0),
        dias=[DiaSemana.LUNES, DiaSemana.MIERCOLES],
    ))

    servicio.eliminar_categoria(categoria.codigo)

    assert db_session.get(CategoriaHorario, categoria.codigo) is None
    assert servicio.listar_horarios(categoria.codigo) == []
    assert db_session.get(CategoriaHorarioDia, (categoria.codigo, DiaSemana.LUNES)) is None


def test_eliminar_categoria_con_asistencias_bloquea_y_no_borra_nada(db_session, client):
    servicio = AsistenciaServicio(db_session)
    categoria = servicio.crear_categoria(CategoriaCreateDTO(
        nombre="Preinfantil", hora_inicio=time(15, 0), hora_fin=time(16, 0),
        dias=[DiaSemana.LUNES],
    ))
    alumno = _crear_persona_api(client)
    horario = servicio.listar_horarios(categoria.codigo)[0]
    servicio.asignar_alumno_a_horario(
        AlumnoHorarioCreateDTO(persona_id=alumno["id"], horario_id=horario.id)
    )
    from app.servicios_negocio.dtos.asistencia_schemas import AsistenciaCreateDTO
    servicio.registrar_asistencia(AsistenciaCreateDTO(
        fecha_entrenamiento="2026-08-10", estado=EstadoAsistencia.PRESENTE,
        persona_id=alumno["id"], horario_id=horario.id,
    ), ["ADMINISTRADOR"], alumno["id"])

    with pytest.raises(OperacionInvalida):
        servicio.eliminar_categoria(categoria.codigo)

    assert db_session.get(CategoriaHorario, categoria.codigo) is not None
    assert len(servicio.listar_horarios(categoria.codigo)) == 1


def test_actualizar_categoria_codigo_inexistente(db_session):
    servicio = AsistenciaServicio(db_session)
    with pytest.raises(EntidadNoEncontrada):
        servicio.actualizar_categoria("NOEXISTE", CategoriaUpdateDTO(nombre="X"))


def test_eliminar_categoria_codigo_inexistente(db_session):
    servicio = AsistenciaServicio(db_session)
    with pytest.raises(EntidadNoEncontrada):
        servicio.eliminar_categoria("NOEXISTE")


# --- Ventana horaria y tope de días (issue #861) ---------------------------
# El club abre a las 06:00 y cierra a las 22:00, y ninguna categoría entrena
# los siete días. Ambos límites valen igual al crear que al editar: hasta el
# issue #861 el único candado de la franja era que el inicio fuera anterior
# al fin, así que un entrenamiento a las 03:00 se guardaba sin protestar.
#
# Los bordes se prueban de los dos lados a propósito. El tope de seis días no
# es un número redondo: Competitivo entrena de lunes a sábado, así que un
# `< 6` en vez de un `<= 6` dejaría a la categoría insignia del club sin
# poder guardarse.
_TODOS_LOS_DIAS = list(DiaSemana)
_LUNES_A_SABADO = _TODOS_LOS_DIAS[:6]


def _alta(servicio, hora_inicio=time(9, 0), hora_fin=time(10, 0), dias=(DiaSemana.LUNES,)):
    """Alta con franja y días válidos: cada prueba de borde sobreescribe solo
    el valor que está poniendo a prueba."""
    return servicio.crear_categoria(CategoriaCreateDTO(
        nombre="Preinfantil", hora_inicio=hora_inicio, hora_fin=hora_fin, dias=list(dias),
    ))


def _con_categoria(db_session):
    """Servicio + el código de una categoría ya válida, para probar la edición."""
    servicio = AsistenciaServicio(db_session)
    return servicio, _alta(servicio).codigo


def _categoria_legada(db_session):
    """Fila con una franja anterior a la ventana del issue #861. Se inserta
    directo contra la base porque el alta ya no la aceptaría, que es
    exactamente la situación que la edición tiene que contemplar."""
    fila = CategoriaHorario(
        codigo="LEGADA", label="Legada", hora_inicio=time(5, 0), hora_fin=time(6, 30),
    )
    fila.dias_permitidos = [CategoriaHorarioDia(dia_semana=DiaSemana.LUNES)]
    db_session.add(fila)
    db_session.flush()
    return fila


def test_crear_categoria_acepta_la_hora_de_apertura_exacta(db_session):
    servicio = AsistenciaServicio(db_session)

    categoria = _alta(servicio, hora_inicio=time(6, 0), hora_fin=time(7, 0))

    assert categoria.hora_inicio == time(6, 0)


def test_crear_categoria_acepta_la_hora_de_cierre_exacta(db_session):
    servicio = AsistenciaServicio(db_session)

    categoria = _alta(servicio, hora_inicio=time(21, 0), hora_fin=time(22, 0))

    assert categoria.hora_fin == time(22, 0)


def test_crear_categoria_rechaza_empezar_antes_de_la_apertura(db_session):
    servicio = AsistenciaServicio(db_session)

    inicio, fin = time(5, 59), time(7, 0)

    with pytest.raises(OperacionInvalida):
        _alta(servicio, hora_inicio=inicio, hora_fin=fin)


def test_crear_categoria_rechaza_terminar_despues_del_cierre(db_session):
    servicio = AsistenciaServicio(db_session)

    inicio, fin = time(21, 0), time(22, 1)

    with pytest.raises(OperacionInvalida):
        _alta(servicio, hora_inicio=inicio, hora_fin=fin)


def test_crear_categoria_acepta_seis_dias(db_session):
    """Competitivo entrena de lunes a sábado: el tope no puede ser cinco."""
    servicio = AsistenciaServicio(db_session)

    categoria = _alta(servicio, dias=_LUNES_A_SABADO)

    assert len(categoria.dias) == 6


def test_crear_categoria_rechaza_los_siete_dias(db_session):
    servicio = AsistenciaServicio(db_session)

    with pytest.raises(OperacionInvalida):
        _alta(servicio, dias=_TODOS_LOS_DIAS)


def test_crear_categoria_acepta_un_solo_dia(db_session):
    servicio = AsistenciaServicio(db_session)

    categoria = _alta(servicio, dias=[DiaSemana.MARTES])

    assert categoria.dias == [DiaSemana.MARTES]


def test_actualizar_categoria_acepta_la_hora_de_apertura_exacta(db_session):
    servicio, codigo = _con_categoria(db_session)

    actualizada = servicio.actualizar_categoria(codigo, CategoriaUpdateDTO(
        hora_inicio=time(6, 0), hora_fin=time(7, 0),
    ))

    assert actualizada.hora_inicio == time(6, 0)


def test_actualizar_categoria_acepta_la_hora_de_cierre_exacta(db_session):
    servicio, codigo = _con_categoria(db_session)

    actualizada = servicio.actualizar_categoria(codigo, CategoriaUpdateDTO(
        hora_inicio=time(21, 0), hora_fin=time(22, 0),
    ))

    assert actualizada.hora_fin == time(22, 0)


def test_actualizar_categoria_rechaza_empezar_antes_de_la_apertura(db_session):
    servicio, codigo = _con_categoria(db_session)

    cambio = CategoriaUpdateDTO(hora_inicio=time(5, 59), hora_fin=time(10, 0))

    with pytest.raises(OperacionInvalida):
        servicio.actualizar_categoria(codigo, cambio)


def test_actualizar_categoria_rechaza_terminar_despues_del_cierre(db_session):
    servicio, codigo = _con_categoria(db_session)

    cambio = CategoriaUpdateDTO(hora_inicio=time(21, 0), hora_fin=time(22, 1))

    with pytest.raises(OperacionInvalida):
        servicio.actualizar_categoria(codigo, cambio)


def test_actualizar_categoria_acepta_seis_dias(db_session):
    servicio, codigo = _con_categoria(db_session)

    actualizada = servicio.actualizar_categoria(
        codigo, CategoriaUpdateDTO(dias=_LUNES_A_SABADO),
    )

    assert len(actualizada.dias) == 6


def test_actualizar_categoria_rechaza_los_siete_dias(db_session):
    servicio, codigo = _con_categoria(db_session)

    cambio = CategoriaUpdateDTO(dias=_TODOS_LOS_DIAS)

    with pytest.raises(OperacionInvalida):
        servicio.actualizar_categoria(codigo, cambio)


def test_actualizar_categoria_rechaza_renombrar_una_franja_legada(db_session):
    """La ventana se valida contra el par FUSIONADO (lo que llega en el
    cuerpo o, si falta, lo guardado). Consecuencia buscada: una fila anterior
    a esta regla no se puede renombrar sin corregir también su franja. Desde
    el formulario no se nota -- siempre manda las dos horas -- y a cambio
    ninguna edición deja viva una franja fuera de la ventana."""
    servicio = AsistenciaServicio(db_session)
    _categoria_legada(db_session)

    cambio = CategoriaUpdateDTO(nombre="Legada A")

    with pytest.raises(OperacionInvalida):
        servicio.actualizar_categoria("LEGADA", cambio)


# --- Etiqueta de edades (opcional) ----------------------------------------
# `edades` es un texto de orientación que el club ya publicaba fuera de la
# base ("5 a 10 años", "Selección"). Es OPCIONAL: una categoría sin etiqueta
# es un estado legítimo, no un dato faltante. Por eso NULL y `""` no pueden
# convivir -- hay una sola representación de "sin etiqueta", y es NULL.
def test_crear_categoria_guarda_la_etiqueta_de_edades(db_session):
    servicio = AsistenciaServicio(db_session)

    categoria = servicio.crear_categoria(CategoriaCreateDTO(
        nombre="Preinfantil", hora_inicio=time(15, 0), hora_fin=time(16, 0),
        dias=[DiaSemana.LUNES], edades="6 a 9 años",
    ))

    assert categoria.edades == "6 a 9 años"
    assert db_session.get(CategoriaHorario, "PREINFANTIL").edades == "6 a 9 años"


def test_crear_categoria_sin_edades_la_deja_en_null(db_session):
    servicio = AsistenciaServicio(db_session)

    categoria = servicio.crear_categoria(CategoriaCreateDTO(
        nombre="Preinfantil", hora_inicio=time(15, 0), hora_fin=time(16, 0),
        dias=[DiaSemana.LUNES],
    ))

    assert categoria.edades is None
    assert db_session.get(CategoriaHorario, "PREINFANTIL").edades is None


def test_crear_categoria_con_edades_en_blanco_guarda_null_no_cadena_vacia(db_session):
    servicio = AsistenciaServicio(db_session)

    categoria = servicio.crear_categoria(CategoriaCreateDTO(
        nombre="Preinfantil", hora_inicio=time(15, 0), hora_fin=time(16, 0),
        dias=[DiaSemana.LUNES], edades="   ",
    ))

    assert categoria.edades is None
    assert db_session.get(CategoriaHorario, "PREINFANTIL").edades is None


def test_crear_categoria_recorta_los_espacios_de_edades(db_session):
    servicio = AsistenciaServicio(db_session)

    categoria = servicio.crear_categoria(CategoriaCreateDTO(
        nombre="Preinfantil", hora_inicio=time(15, 0), hora_fin=time(16, 0),
        dias=[DiaSemana.LUNES], edades="  6 a 9 años  ",
    ))

    assert categoria.edades == "6 a 9 años"


def test_actualizar_categoria_asigna_la_etiqueta_de_edades(db_session):
    servicio = AsistenciaServicio(db_session)
    servicio.crear_categoria(CategoriaCreateDTO(
        nombre="Preinfantil", hora_inicio=time(15, 0), hora_fin=time(16, 0),
        dias=[DiaSemana.LUNES],
    ))

    categoria = servicio.actualizar_categoria("PREINFANTIL", CategoriaUpdateDTO(edades="6 a 9 años"))

    assert categoria.edades == "6 a 9 años"
    assert db_session.get(CategoriaHorario, "PREINFANTIL").edades == "6 a 9 años"


def test_actualizar_categoria_con_edades_null_borra_la_etiqueta(db_session):
    """`edades: null` EXPLÍCITO limpia la etiqueta. Se distingue de "no vino
    el campo" con `exclude_unset`, igual que el resto del PUT parcial."""
    servicio = AsistenciaServicio(db_session)
    servicio.crear_categoria(CategoriaCreateDTO(
        nombre="Preinfantil", hora_inicio=time(15, 0), hora_fin=time(16, 0),
        dias=[DiaSemana.LUNES], edades="6 a 9 años",
    ))

    categoria = servicio.actualizar_categoria("PREINFANTIL", CategoriaUpdateDTO(edades=None))

    assert categoria.edades is None
    assert db_session.get(CategoriaHorario, "PREINFANTIL").edades is None


def test_actualizar_categoria_sin_mandar_edades_no_la_toca(db_session):
    servicio = AsistenciaServicio(db_session)
    servicio.crear_categoria(CategoriaCreateDTO(
        nombre="Preinfantil", hora_inicio=time(15, 0), hora_fin=time(16, 0),
        dias=[DiaSemana.LUNES], edades="6 a 9 años",
    ))

    categoria = servicio.actualizar_categoria("PREINFANTIL", CategoriaUpdateDTO(nombre="Preinfantil A"))

    assert categoria.label == "Preinfantil A"
    assert categoria.edades == "6 a 9 años"


def test_actualizar_categoria_con_edades_en_blanco_borra_la_etiqueta(db_session):
    servicio = AsistenciaServicio(db_session)
    servicio.crear_categoria(CategoriaCreateDTO(
        nombre="Preinfantil", hora_inicio=time(15, 0), hora_fin=time(16, 0),
        dias=[DiaSemana.LUNES], edades="6 a 9 años",
    ))

    categoria = servicio.actualizar_categoria("PREINFANTIL", CategoriaUpdateDTO(edades="   "))

    assert categoria.edades is None


def test_actualizar_solo_edades_no_es_un_put_vacio(db_session):
    """`edades` sola alcanza para que el PUT tenga contenido: sin esto
    caería en "No se proporcionaron campos para actualizar"."""
    servicio = AsistenciaServicio(db_session)
    servicio.crear_categoria(CategoriaCreateDTO(
        nombre="Preinfantil", hora_inicio=time(15, 0), hora_fin=time(16, 0),
        dias=[DiaSemana.LUNES],
    ))

    categoria = servicio.actualizar_categoria("PREINFANTIL", CategoriaUpdateDTO(edades="6 a 9 años"))

    assert categoria.edades == "6 a 9 años"


# --- Endpoints HTTP: alta/edición/baja, ADMIN-only ------------------------
def test_post_categorias_crea_y_devuelve_201(client):
    resp = client.post("/api/v1/asistencias/categorias", json={
        "nombre": "Preinfantil", "hora_inicio": "15:00:00", "hora_fin": "16:00:00",
        "dias": ["LUNES", "MIERCOLES"],
    })

    assert resp.status_code == 201
    body = resp.json()
    assert body["codigo"] == "PREINFANTIL"
    assert set(body["dias"]) == {"LUNES", "MIERCOLES"}


def test_post_categorias_sin_admin_devuelve_403(client_sin_permisos):
    resp = client_sin_permisos.post("/api/v1/asistencias/categorias", json={
        "nombre": "Preinfantil", "hora_inicio": "15:00:00", "hora_fin": "16:00:00",
        "dias": ["LUNES"],
    })

    assert resp.status_code == 403


def test_put_categorias_actualiza(client):
    creada = client.post("/api/v1/asistencias/categorias", json={
        "nombre": "Preinfantil", "hora_inicio": "15:00:00", "hora_fin": "16:00:00",
        "dias": ["LUNES"],
    }).json()

    resp = client.put(f"/api/v1/asistencias/categorias/{creada['codigo']}", json={
        "nombre": "Preinfantil A",
    })

    assert resp.status_code == 200
    assert resp.json()["label"] == "Preinfantil A"


def test_post_categorias_devuelve_edades_con_la_clave_edades(client):
    """La clave de red la fija el `alias_generator` de `ResponseBase`, así que
    se verifica contra la respuesta real y no se asume."""
    resp = client.post("/api/v1/asistencias/categorias", json={
        "nombre": "Preinfantil", "hora_inicio": "15:00:00", "hora_fin": "16:00:00",
        "dias": ["LUNES"], "edades": "6 a 9 años",
    })

    assert resp.status_code == 201
    assert resp.json()["edades"] == "6 a 9 años"


def test_post_categorias_sin_edades_devuelve_null(client):
    resp = client.post("/api/v1/asistencias/categorias", json={
        "nombre": "Preinfantil", "hora_inicio": "15:00:00", "hora_fin": "16:00:00",
        "dias": ["LUNES"],
    })

    assert resp.status_code == 201
    assert resp.json()["edades"] is None


def test_put_categorias_limpia_edades_con_null_explicito(client):
    creada = client.post("/api/v1/asistencias/categorias", json={
        "nombre": "Preinfantil", "hora_inicio": "15:00:00", "hora_fin": "16:00:00",
        "dias": ["LUNES"], "edades": "6 a 9 años",
    }).json()

    resp = client.put(f"/api/v1/asistencias/categorias/{creada['codigo']}", json={"edades": None})

    assert resp.status_code == 200
    assert resp.json()["edades"] is None


def test_get_categorias_expone_edades(client):
    client.post("/api/v1/asistencias/categorias", json={
        "nombre": "Preinfantil", "hora_inicio": "15:00:00", "hora_fin": "16:00:00",
        "dias": ["LUNES"], "edades": "6 a 9 años",
    })

    body = client.get("/api/v1/asistencias/categorias").json()

    por_codigo = {c["codigo"]: c for c in body}
    assert por_codigo["PREINFANTIL"]["edades"] == "6 a 9 años"
    assert por_codigo["FORMATIVO"]["edades"] == "5 a 10 años"


def test_delete_categorias_borra(client):
    creada = client.post("/api/v1/asistencias/categorias", json={
        "nombre": "Preinfantil", "hora_inicio": "15:00:00", "hora_fin": "16:00:00",
        "dias": ["LUNES"],
    }).json()

    resp = client.delete(f"/api/v1/asistencias/categorias/{creada['codigo']}")

    assert resp.status_code == 204
    assert client.get("/api/v1/asistencias/categorias").json()
    codigos = {c["codigo"] for c in client.get("/api/v1/asistencias/categorias").json()}
    assert creada["codigo"] not in codigos
