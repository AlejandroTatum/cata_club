"""Tests de los reportes agregados: asistencia por horario/periodo/alumno
(E02-RF005), alumnos nuevos por periodo (E04-RF014), y exportación a PDF de
los reportes de periodo y asistencia (report-pdf-export). El reporte de
personas por etiquetas fue removido upstream (#131) junto con
`prioridad_municipal`/`porcentaje_beca`, así que su export PDF nunca llegó
a existir en `main`."""

from datetime import date, datetime, timezone

import pytest
from reportlab.lib import colors
from reportlab.platypus import Paragraph

from app.dominio.cedula import cedula_valida
from app.dominio.modelos import Pago, Persona
from app.infraestructura import generador_pdf
from app.infraestructura.generador_pdf import generar_reporte_pdf
from app.presentacion.routers.asistencias_router import _COLUMNAS_ASISTENCIA_PDF
from app.presentacion.routers.membresias_pagos_router import _COLUMNAS_PAGOS_PDF
from app.presentacion.routers.personas_router import _COLUMNAS_PERSONAS_PDF


def _crear_persona(client, cedula):
    return client.post(
        "/api/v1/personas/",
        json={
            "nombres": "Test", "apellidos": cedula, "cedula": cedula,
            "fecha_nacimiento": "2000-05-14", "telefono": "0991234567",
        },
    ).json()


def _crear_tipo_membresia(client, modalidad="MENSUAL"):
    return client.post(
        "/api/v1/membresias/tipos",
        json={
            "categoria": "Adultos",
            "precio": "35.00", "modalidad": modalidad,
        },
    ).json()


def _crear_pago(client, cedula, estado_pago=None, monto="35.00"):
    """Crea persona + tipo de membresía + membresía + pago (flujo reutilizado
    de test_membresias_pagos.py). Si `estado_pago` se pasa, valida el pago
    con ese estado tras crearlo.

    `monto` sigue siendo el nombre del parámetro porque sigue fijando el
    precio del catálogo (`monto_aplicado`, columna de `Membresia`); el pago
    en sí ya no lo recibe (issue #400/4b, `PagoCreateDTO.meses`). Ningún
    call site de este archivo pasa `monto` distinto del default, así que
    siempre compra exactamente 1 mes -- no hace falta derivar `meses` del
    parámetro."""
    persona = _crear_persona(client, cedula)
    tipo = _crear_tipo_membresia(client)
    membresia = client.post(
        "/api/v1/membresias/",
        json={
            "monto_aplicado": monto, "fecha_activacion": "2026-07-01T00:00:00",
            "persona_id": persona["id"], "tipo_membresia_id": tipo["id"],
        },
    ).json()
    pago = client.post(
        "/api/v1/membresias/pagos",
        json={
            "meses": 1, "tipo_pago": "TRANSFERENCIA",
            "fecha_inicio": "2026-07-01", "fecha_fin": "2026-07-31",
            "persona_id": persona["id"], "membresia_id": membresia["id"],
        },
    ).json()
    if estado_pago is not None:
        payload = {"estado_pago": estado_pago}
        if estado_pago == "APROBADO":
            # Issue #459: TRANSFERENCIA sin voucher adjunto -- sin este
            # motivo, aprobar devuelve 400 desde este fix. RECHAZADO no lo
            # necesita (ver `PagoServicio.validar_pago`: la excepción solo
            # se exige al aprobar) -- se deja sin tocar, fuera de alcance.
            payload["motivo_excepcion_sin_comprobante"] = "Verificado directamente en la cuenta del club."
        client.patch(
            f"/api/v1/membresias/pagos/{pago['id']}/validar",
            json=payload,
        )
    return pago


# --- Los rangos de los reportes son DÍAS DEL CLUB, no días UTC (#761) -------
#
# Los usa el reporte de pagos y el de alumnos nuevos por período: las dos
# pestañas de `/reports` arman su rango con el MISMO `buildReportDateRange`,
# que lo expresa en días del CLUB (`clubToday`, zona `America/Guayaquil`, ver
# `frontend/src/lib/club-date.ts`). Las dos columnas filtradas
# (`Pago.fecha_registro`, `Persona.fecha_registro`) guardan, en cambio, un
# INSTANTE en UTC (`timestamptz`, `default=_ahora_utc`).
#
# Armar el tope como `fecha_fin 23:59:59.999999 UTC` recortaba las últimas
# CINCO horas de cada día del club: lo registrado a las 19:30 hora del club se
# guarda como 00:30 UTC del día siguiente, un instante MAYOR que ese tope.
# Desaparecía de todos los presets a la vez -- incluido "Histórico completo",
# que tampoco es una consulta sin límites: su `fecha_fin` también es "hoy".

# Día del club sobre el que se consulta. Un rango de un solo día
# (`fecha_inicio == fecha_fin`) es exactamente lo que pide el preset "Hoy".
DIA_DEL_CLUB_DEL_REPORTE = date(2026, 7, 15)

# 19:30 del día del club de arriba, expresado como el instante UTC que la
# base efectivamente guarda: el club está en UTC-5, así que son las 00:30 del
# día SIGUIENTE en UTC.
REGISTRO_AL_ANOCHECER_UTC = datetime(2026, 7, 16, 0, 30, tzinfo=timezone.utc)

# 19:30 del día del club ANTERIOR (00:30 UTC del día del club consultado).
# Fija el otro borde: el piso del rango también es del club, así que esto NO
# pertenece al día consultado aunque su fecha UTC coincida.
REGISTRO_DE_LA_VISPERA_UTC = datetime(2026, 7, 15, 0, 30, tzinfo=timezone.utc)

# Piso de "Histórico completo": la fecha de fundación del club
# (`FOUNDING_DATE` en `frontend/src/app/landing/landing-config.ts`), que es
# lo que `FOUNDING_DATE_ISO` manda como `fecha_inicio` de ese preset.
FUNDACION_DEL_CLUB = date(2013, 10, 10)


def _fijar_fecha_registro(db_session, modelo, registro_id: int, instante: datetime) -> None:
    """Fija `fecha_registro` a un instante elegido por el test.

    Ningún endpoint permite elegirlo (`default=_ahora_utc`), y derivarlo del
    reloj real haría que la prueba pasara o fallara según la hora a la que se
    corra. Se escribe por la sesión del test, que es la MISMA que usa el
    `client` (ver `db_session`/`client` en `conftest.py`)."""
    fila = db_session.get(modelo, registro_id)
    fila.fecha_registro = instante
    db_session.commit()


def test_reporte_asistencia_requiere_admin_o_entrenador(client_sin_permisos):
    resp = client_sin_permisos.get("/api/v1/asistencias/reportes")
    assert resp.status_code == 403


def test_reporte_asistencia_filtra_por_horario_y_periodo(client):
    alumno = _crear_persona(client, cedula_valida(550))

    horario = client.post(
        "/api/v1/asistencias/horarios",
        json={"categoria": "FORMATIVO", "dia_semana": "LUNES"},
    ).json()
    client.post(
        "/api/v1/asistencias/asignar-alumno",
        json={"persona_id": alumno["id"], "horario_id": horario["id"]},
    )

    client.post(
        "/api/v1/asistencias/",
        json={
            "fecha_entrenamiento": "2026-07-06", "estado": "PRESENTE",
            "persona_id": alumno["id"], "horario_id": horario["id"],
        },
    )
    client.post(
        "/api/v1/asistencias/",
        json={
            "fecha_entrenamiento": "2026-08-06", "estado": "AUSENTE",
            "persona_id": alumno["id"], "horario_id": horario["id"],
        },
    )

    resp = client.get(
        "/api/v1/asistencias/reportes",
        params={"horario_id": horario["id"], "fecha_inicio": "2026-07-01", "fecha_fin": "2026-07-31"},
    )
    assert resp.status_code == 200
    body = resp.json()["items"]
    assert len(body) == 1
    assert body[0]["estado"] == "PRESENTE"


def test_reporte_asistencia_expone_horario_id_y_persona_id(client):
    """The report rows must carry the RAW ids, not just the values a UI would
    print. `AsistenciaResponseDTO` has always declared `horario_id`, but until
    the trainer history's "Corregir" deep link (#95) nothing downstream read
    it, so nothing stopped it from being dropped as unused. It is a consumed
    part of the contract now: the frontend resolves the session to correct
    from `horarioId` + `fechaEntrenamiento`, and a display label cannot stand
    in for either. Asserted through the HTTP payload, in camelCase, because
    that is the shape the adapter parses -- `ResponseBase`'s alias generator
    is part of what is being locked down here."""
    alumno = _crear_persona(client, cedula_valida(551))

    horario = client.post(
        "/api/v1/asistencias/horarios",
        json={"categoria": "FORMATIVO", "dia_semana": "MARTES"},
    ).json()
    client.post(
        "/api/v1/asistencias/asignar-alumno",
        json={"persona_id": alumno["id"], "horario_id": horario["id"]},
    )
    client.post(
        "/api/v1/asistencias/",
        json={
            "fecha_entrenamiento": "2026-07-07", "estado": "PRESENTE",
            "persona_id": alumno["id"], "horario_id": horario["id"],
        },
    )

    resp = client.get(
        "/api/v1/asistencias/reportes",
        params={"horario_id": horario["id"]},
    )
    assert resp.status_code == 200
    fila = resp.json()["items"][0]
    assert fila["horarioId"] == horario["id"]
    assert fila["personaId"] == alumno["id"]
    assert fila["fechaEntrenamiento"] == "2026-07-07"


def test_reporte_alumnos_nuevos_por_periodo(client):
    _crear_persona(client, cedula_valida(552))
    resp = client.get(
        "/api/v1/personas/reportes/nuevos-por-periodo",
        params={"fecha_inicio": "2026-01-01", "fecha_fin": "2026-12-31"},
    )
    assert resp.status_code == 200
    assert len(resp.json()) >= 1


def test_reporte_alumnos_nuevos_por_periodo_requiere_admin(client_sin_permisos):
    resp = client_sin_permisos.get(
        "/api/v1/personas/reportes/nuevos-por-periodo",
        params={"fecha_inicio": "2026-01-01", "fecha_fin": "2026-12-31"},
    )
    assert resp.status_code == 403


# Rango en días del club para "Nuevos miembros por período" (issue #761): el
# mismo defecto que el reporte de pagos, en la otra pestaña de `/reports`. Ver
# el bloque de constantes arriba para el porqué.
#
# Estas pruebas reemplazan a `test_reporte_alumnos_nuevos_por_periodo_acepta_
# un_solo_dia`, que derivaba la fecha de la consulta del propio
# `persona["fechaRegistro"][:10]` -- el día UTC del dato que verificaba. Era
# verde por construcción: le preguntaba al dato qué afirmar. La aceptación de
# un rango de un solo día sigue cubierta: el caso "Hoy" de acá ES
# `fecha_inicio == fecha_fin`.

def test_reporte_personas_incluye_lo_registrado_al_final_del_dia_del_club(client, db_session):
    """Una persona registrada a las 19:30 hora del club sale ese MISMO día del
    club, tanto en el preset "Hoy" como en "Histórico completo"."""
    persona = _crear_persona(client, cedula_valida(553))
    _fijar_fecha_registro(db_session, Persona, persona["id"], REGISTRO_AL_ANOCHECER_UTC)
    dia = DIA_DEL_CLUB_DEL_REPORTE.isoformat()

    hoy = client.get(
        "/api/v1/personas/reportes/nuevos-por-periodo",
        params={"fecha_inicio": dia, "fecha_fin": dia},
    )
    assert hoy.status_code == 200, hoy.text
    assert any(p["id"] == persona["id"] for p in hoy.json())

    historico = client.get(
        "/api/v1/personas/reportes/nuevos-por-periodo",
        params={"fecha_inicio": FUNDACION_DEL_CLUB.isoformat(), "fecha_fin": dia},
    )
    assert historico.status_code == 200, historico.text
    assert any(p["id"] == persona["id"] for p in historico.json())


def test_reporte_personas_excluye_lo_registrado_la_vispera_del_dia_del_club(client, db_session):
    """El otro borde del mismo rango: una persona de las 19:30 del día del
    club ANTERIOR no pertenece al día consultado, aunque su fecha UTC (00:30
    del día siguiente) sí coincida."""
    persona = _crear_persona(client, cedula_valida(565))
    _fijar_fecha_registro(db_session, Persona, persona["id"], REGISTRO_DE_LA_VISPERA_UTC)
    dia = DIA_DEL_CLUB_DEL_REPORTE.isoformat()

    resp = client.get(
        "/api/v1/personas/reportes/nuevos-por-periodo",
        params={"fecha_inicio": dia, "fecha_fin": dia},
    )
    assert resp.status_code == 200, resp.text
    assert not any(p["id"] == persona["id"] for p in resp.json())


def test_reporte_personas_pdf_incluye_lo_registrado_al_final_del_dia_del_club(
    client, db_session, monkeypatch,
):
    """El PDF arma su propio rango (`reporte_nuevos_por_periodo_pdf` no
    reutiliza el endpoint JSON, cada uno construye sus límites), así que el
    defecto podía sobrevivir en uno de los dos. Se espían las filas que llegan
    a `generar_reporte_pdf`: los bytes del PDF no son legibles como texto y
    afirmar solo `200` no distingue un reporte completo de uno vacío."""
    import app.presentacion.routers.personas_router as router_mod

    cedula = cedula_valida(566)
    persona = _crear_persona(client, cedula)
    _fijar_fecha_registro(db_session, Persona, persona["id"], REGISTRO_AL_ANOCHECER_UTC)
    dia = DIA_DEL_CLUB_DEL_REPORTE.isoformat()

    filas_generadas = []

    def _generar_espia(*args, filas, **kwargs):
        filas_generadas.extend(filas)
        return generar_reporte_pdf(*args, filas=filas, **kwargs)

    monkeypatch.setattr(router_mod, "generar_reporte_pdf", _generar_espia)

    resp = client.get(
        "/api/v1/personas/reportes/nuevos-por-periodo/pdf",
        params={"fecha_inicio": dia, "fecha_fin": dia},
    )

    assert resp.status_code == 200, resp.text
    assert any(cedula in fila for fila in filas_generadas)


# --- Phase 1: generar_reporte_pdf (unit) ------------------------------------

def test_generar_reporte_pdf_produce_bytes_pdf_validos():
    pdf_bytes = generar_reporte_pdf(
        titulo="Reporte de prueba",
        columnas=["Nombre", "Cédula"],
        filas=[["Juan Pérez", "1710034065"]],
    )
    assert isinstance(pdf_bytes, bytes)
    assert pdf_bytes[:4] == b"%PDF"


def test_generar_reporte_pdf_una_pagina_con_7_filas():
    filas = [[f"Persona {i}", f"{i:010d}"] for i in range(7)]
    pdf_bytes = generar_reporte_pdf(
        titulo="Reporte de 7 filas", columnas=["Nombre", "Cédula"], filas=filas,
    )
    assert pdf_bytes[:4] == b"%PDF"
    assert len(pdf_bytes) > 0


def test_generar_reporte_pdf_pagina_multiple_con_25_filas():
    filas_pocas = [[f"Persona {i}", f"{i:010d}"] for i in range(7)]
    filas_muchas = [[f"Persona {i}", f"{i:010d}"] for i in range(25)]
    pdf_pocas = generar_reporte_pdf(
        titulo="Reporte", columnas=["Nombre", "Cédula"], filas=filas_pocas,
    )
    pdf_muchas = generar_reporte_pdf(
        titulo="Reporte", columnas=["Nombre", "Cédula"], filas=filas_muchas,
    )
    assert pdf_muchas[:4] == b"%PDF"
    # Sanity de paginación: 25 filas (3 páginas de contenido) deben producir
    # un PDF sustancialmente más grande que uno de 7 filas (1 página).
    assert len(pdf_muchas) > len(pdf_pocas)


def test_generar_reporte_pdf_filas_vacias_no_lanza():
    pdf_bytes = generar_reporte_pdf(
        titulo="Reporte sin resultados", columnas=["Nombre", "Cédula"], filas=[],
    )
    assert pdf_bytes[:4] == b"%PDF"
    assert len(pdf_bytes) > 0


# --- Phase 2: endpoints PDF (integración) ------------------------------------

def test_reporte_periodo_pdf_sin_token_da_401(client_sin_token):
    resp = client_sin_token.get(
        "/api/v1/personas/reportes/nuevos-por-periodo/pdf",
        params={"fecha_inicio": "2026-01-01", "fecha_fin": "2026-12-31"},
    )
    assert resp.status_code == 401


def test_reporte_asistencia_pdf_sin_token_da_401(client_sin_token):
    assert client_sin_token.get("/api/v1/asistencias/reportes/pdf").status_code == 401


def test_reporte_periodo_pdf_requiere_admin(client_sin_permisos):
    resp = client_sin_permisos.get(
        "/api/v1/personas/reportes/nuevos-por-periodo/pdf",
        params={"fecha_inicio": "2026-01-01", "fecha_fin": "2026-12-31"},
    )
    assert resp.status_code == 403


def test_reporte_asistencia_pdf_requiere_admin(client_sin_permisos):
    resp = client_sin_permisos.get("/api/v1/asistencias/reportes/pdf")
    assert resp.status_code == 403


def test_reporte_asistencia_pdf_rechaza_entrenador(client_entrenador):
    """Regresión: el export PDF de asistencia es MÁS estricto que su hermano
    JSON -- ENTRENADOR puede ver el JSON pero NO exportar el PDF."""
    resp = client_entrenador.get("/api/v1/asistencias/reportes/pdf")
    assert resp.status_code == 403


def test_reporte_asistencia_json_permite_entrenador_como_control(client_entrenador):
    """Control: confirma que el endpoint JSON (sin tocar) sigue permitiendo
    ENTRENADOR -- contraste directo con el 403 del PDF de arriba."""
    resp = client_entrenador.get("/api/v1/asistencias/reportes")
    assert resp.status_code == 200


def test_reporte_periodo_pdf_admin_200(client):
    _crear_persona(client, cedula_valida(553))
    resp = client.get(
        "/api/v1/personas/reportes/nuevos-por-periodo/pdf",
        params={"fecha_inicio": "2026-01-01", "fecha_fin": "2026-12-31"},
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert len(resp.content) > 0
    disposition = resp.headers["content-disposition"]
    assert "reporte-periodo_" in disposition


def test_reporte_periodo_pdf_422_fechas_invertidas(client):
    resp = client.get(
        "/api/v1/personas/reportes/nuevos-por-periodo/pdf",
        params={"fecha_inicio": "2026-12-31", "fecha_fin": "2026-01-01"},
    )
    assert resp.status_code == 422


# Un rango invertido devolvía 200 con lista vacía: una respuesta silenciosa y
# equivocada ("no hubo asistencias") en vez de un error. Se alinea con los
# hermanos de personas y pagos, que ya devuelven 422 con el mismo mensaje.
def test_reporte_asistencia_422_fechas_invertidas(client):
    resp = client.get(
        "/api/v1/asistencias/reportes",
        params={"fecha_inicio": "2026-12-31", "fecha_fin": "2026-01-01"},
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == "La fecha de inicio debe ser anterior a la fecha de fin."


def test_reporte_asistencia_pdf_422_fechas_invertidas(client):
    resp = client.get(
        "/api/v1/asistencias/reportes/pdf",
        params={"fecha_inicio": "2026-12-31", "fecha_fin": "2026-01-01"},
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == "La fecha de inicio debe ser anterior a la fecha de fin."


def test_reporte_asistencia_acepta_un_solo_dia_y_filtros_parciales(client):
    """El rango es opcional y combinable: un único día (inicio == fin) y un
    extremo suelto siguen siendo consultas válidas, no errores."""
    assert client.get(
        "/api/v1/asistencias/reportes",
        params={"fecha_inicio": "2026-07-06", "fecha_fin": "2026-07-06"},
    ).status_code == 200
    assert client.get(
        "/api/v1/asistencias/reportes", params={"fecha_inicio": "2026-07-06"}
    ).status_code == 200
    assert client.get(
        "/api/v1/asistencias/reportes", params={"fecha_fin": "2026-07-06"}
    ).status_code == 200


def test_reporte_asistencia_pdf_admin_200(client):
    alumno = _crear_persona(client, cedula_valida(554))
    horario = client.post(
        "/api/v1/asistencias/horarios",
        json={"categoria": "FORMATIVO", "dia_semana": "LUNES"},
    ).json()
    client.post(
        "/api/v1/asistencias/asignar-alumno",
        json={"persona_id": alumno["id"], "horario_id": horario["id"]},
    )
    client.post(
        "/api/v1/asistencias/",
        json={
            "fecha_entrenamiento": "2026-07-06", "estado": "PRESENTE",
            "persona_id": alumno["id"], "horario_id": horario["id"],
        },
    )

    resp = client.get("/api/v1/asistencias/reportes/pdf")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert len(resp.content) > 0
    disposition = resp.headers["content-disposition"]
    assert "reporte-asistencia_" in disposition


# --- Phase 5: regresión -- offload de `generar_reporte_pdf` fuera del ------
# event loop. Los 3 handlers son `async def` pero `generar_reporte_pdf` es
# CPU-bound (ReportLab). Sin `run_in_threadpool`, la generación corre inline
# en el event loop y bloquea al único worker uvicorn (ver
# `generar_comprobante_pago_pdf`, que por la misma razón se ejecuta en una
# tarea Celery, nunca inline en un handler). Estas pruebas confirman que cada
# endpoint delega la llamada al threadpool en vez de invocarla directamente.
def test_reporte_periodo_pdf_usa_threadpool(client, monkeypatch):
    import app.presentacion.routers.personas_router as router_mod

    llamadas = []
    original = router_mod.run_in_threadpool

    async def _run_in_threadpool_espia(func, *args, **kwargs):
        llamadas.append(func)
        return await original(func, *args, **kwargs)

    monkeypatch.setattr(router_mod, "run_in_threadpool", _run_in_threadpool_espia)

    resp = client.get(
        "/api/v1/personas/reportes/nuevos-por-periodo/pdf",
        params={"fecha_inicio": "2026-01-01", "fecha_fin": "2026-12-31"},
    )
    assert resp.status_code == 200
    assert llamadas == [generar_reporte_pdf]


def test_reporte_asistencia_pdf_usa_threadpool(client, monkeypatch):
    import app.presentacion.routers.asistencias_router as router_mod

    llamadas = []
    original = router_mod.run_in_threadpool

    async def _run_in_threadpool_espia(func, *args, **kwargs):
        llamadas.append(func)
        return await original(func, *args, **kwargs)

    monkeypatch.setattr(router_mod, "run_in_threadpool", _run_in_threadpool_espia)

    resp = client.get("/api/v1/asistencias/reportes/pdf")
    assert resp.status_code == 200
    assert llamadas == [generar_reporte_pdf]


# --- Reporte de pagos (E04-RF014-style, GET /membresias/pagos/reportes) -----

def test_reporte_pagos_requiere_admin(client_sin_permisos):
    resp = client_sin_permisos.get("/api/v1/membresias/pagos/reportes")
    assert resp.status_code == 403


def test_reporte_pagos_filtra_por_estado(client):
    _crear_pago(client, cedula_valida(555), estado_pago="APROBADO")
    _crear_pago(client, cedula_valida(556), estado_pago="RECHAZADO")

    resp = client.get("/api/v1/membresias/pagos/reportes", params={"estado_pago": "APROBADO"})
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["estadoPago"] == "APROBADO"


def test_reporte_pagos_conserva_historia_de_persona_archivada(client, db_session):
    pago = _crear_pago(client, cedula_valida(590), estado_pago="APROBADO")
    db_session.get(Persona, pago["personaId"]).activo = False
    db_session.commit()

    assert any(item["id"] == pago["id"] for item in client.get("/api/v1/membresias/pagos/reportes").json())
    assert client.get("/api/v1/membresias/pagos/reportes/pdf").status_code == 200


def test_reporte_pagos_filtra_por_periodo(client):
    _crear_pago(client, cedula_valida(557))

    resp = client.get(
        "/api/v1/membresias/pagos/reportes",
        params={"fecha_inicio": "2026-01-01", "fecha_fin": "2026-12-31"},
    )
    assert resp.status_code == 200
    assert len(resp.json()) >= 1

    resp_fuera_de_rango = client.get(
        "/api/v1/membresias/pagos/reportes",
        params={"fecha_inicio": "2020-01-01", "fecha_fin": "2020-12-31"},
    )
    assert resp_fuera_de_rango.status_code == 200
    assert resp_fuera_de_rango.json() == []


def test_reporte_pagos_422_fechas_invertidas(client):
    resp = client.get(
        "/api/v1/membresias/pagos/reportes",
        params={"fecha_inicio": "2026-12-31", "fecha_fin": "2026-01-01"},
    )
    assert resp.status_code == 422


# Rango en días del club para el reporte de pagos (issue #761): ver el bloque
# de constantes junto a `_fijar_fecha_registro`, arriba, para el porqué.
#
# Estas pruebas reemplazan a `test_reporte_pagos_acepta_un_solo_dia`, que
# derivaba la fecha de la consulta del propio `pago["fechaRegistro"][:10]` --
# el día UTC del dato que estaba verificando. Era verde por construcción: le
# preguntaba al dato qué afirmar, así que no podía ver una divergencia entre
# el día del club y UTC. La aceptación de un rango de un solo día sigue
# cubierta: el caso "Hoy" de acá ES `fecha_inicio == fecha_fin`.

def test_reporte_pagos_incluye_lo_registrado_al_final_del_dia_del_club(client, db_session):
    """Un pago registrado a las 19:30 hora del club sale ese MISMO día del
    club, tanto en el preset "Hoy" (rango de un solo día) como en "Histórico
    completo"."""
    pago = _crear_pago(client, cedula_valida(558))
    _fijar_fecha_registro(db_session, Pago, pago["id"], REGISTRO_AL_ANOCHECER_UTC)
    dia = DIA_DEL_CLUB_DEL_REPORTE.isoformat()

    hoy = client.get(
        "/api/v1/membresias/pagos/reportes",
        params={"fecha_inicio": dia, "fecha_fin": dia},
    )
    assert hoy.status_code == 200, hoy.text
    assert any(p["id"] == pago["id"] for p in hoy.json())

    historico = client.get(
        "/api/v1/membresias/pagos/reportes",
        params={"fecha_inicio": FUNDACION_DEL_CLUB.isoformat(), "fecha_fin": dia},
    )
    assert historico.status_code == 200, historico.text
    assert any(p["id"] == pago["id"] for p in historico.json())


def test_reporte_pagos_excluye_lo_registrado_la_vispera_del_dia_del_club(client, db_session):
    """El otro borde del mismo rango: un pago de las 19:30 del día del club
    ANTERIOR no pertenece al día consultado, aunque su fecha UTC (00:30 del
    día siguiente) sí coincida. Sin esta prueba, un piso armado en UTC
    seguiría pareciendo correcto."""
    pago = _crear_pago(client, cedula_valida(564))
    _fijar_fecha_registro(db_session, Pago, pago["id"], REGISTRO_DE_LA_VISPERA_UTC)
    dia = DIA_DEL_CLUB_DEL_REPORTE.isoformat()

    resp = client.get(
        "/api/v1/membresias/pagos/reportes",
        params={"fecha_inicio": dia, "fecha_fin": dia},
    )
    assert resp.status_code == 200, resp.text
    assert not any(p["id"] == pago["id"] for p in resp.json())


def test_reporte_pagos_pdf_sin_token_da_401(client_sin_token):
    resp = client_sin_token.get("/api/v1/membresias/pagos/reportes/pdf")
    assert resp.status_code == 401


def test_reporte_pagos_pdf_requiere_admin(client_sin_permisos):
    resp = client_sin_permisos.get("/api/v1/membresias/pagos/reportes/pdf")
    assert resp.status_code == 403


def test_reporte_pagos_pdf_admin_200(client):
    _crear_pago(client, cedula_valida(558), estado_pago="APROBADO")

    resp = client.get("/api/v1/membresias/pagos/reportes/pdf")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.content[:4] == b"%PDF"
    disposition = resp.headers["content-disposition"]
    assert "reporte-pagos_" in disposition


def test_reporte_pagos_pdf_422_fechas_invertidas(client):
    resp = client.get(
        "/api/v1/membresias/pagos/reportes/pdf",
        params={"fecha_inicio": "2026-12-31", "fecha_fin": "2026-01-01"},
    )
    assert resp.status_code == 422


def test_reporte_pagos_pdf_usa_threadpool(client, monkeypatch):
    import app.presentacion.routers.membresias_pagos_router as router_mod

    llamadas = []
    original = router_mod.run_in_threadpool

    async def _run_in_threadpool_espia(func, *args, **kwargs):
        llamadas.append(func)
        return await original(func, *args, **kwargs)

    monkeypatch.setattr(router_mod, "run_in_threadpool", _run_in_threadpool_espia)

    resp = client.get("/api/v1/membresias/pagos/reportes/pdf")
    assert resp.status_code == 200
    assert llamadas == [generar_reporte_pdf]


# --- Tope del reporte de pagos (sdd/api-abuse-protection, D5) ---------------
#
# `_reporte_pagos_items` pedía siempre `limit=10000` a `PagoServicio.listar_pagos`
# y descartaba el `total` real que ese método ya devuelve (independiente del
# `limit`, ver `membresia_pago_servicio.py`). Un rango de fechas que matcheara
# más de 10000 pagos se truncaba en silencio: el llamador recibía una
# respuesta 200 con los primeros N pagos y ninguna señal de que faltaban
# filas. Estas pruebas fijan el reemplazo: en vez de truncar, se rechaza con
# 422 -- mismo patrón que el 422 ya existente para un rango de fechas
# invertido, unas líneas más arriba en `_reporte_pagos_items`.
def test_reporte_pagos_supera_el_limite_maximo_da_422(client, monkeypatch):
    monkeypatch.setattr(
        "app.presentacion.routers.membresias_pagos_router.LIMITE_MAXIMO_REPORTE_PAGOS", 2,
    )
    _crear_pago(client, cedula_valida(559))
    _crear_pago(client, cedula_valida(560))
    _crear_pago(client, "1801010107")

    resp = client.get("/api/v1/membresias/pagos/reportes")
    assert resp.status_code == 422
    assert "2" in resp.json()["detail"]


def test_reporte_pagos_pdf_supera_el_limite_maximo_da_422(client, monkeypatch):
    monkeypatch.setattr(
        "app.presentacion.routers.membresias_pagos_router.LIMITE_MAXIMO_REPORTE_PAGOS", 2,
    )
    _crear_pago(client, cedula_valida(561))
    _crear_pago(client, cedula_valida(562))
    _crear_pago(client, cedula_valida(563))

    resp = client.get("/api/v1/membresias/pagos/reportes/pdf")
    assert resp.status_code == 422


def test_reporte_pagos_exactamente_en_el_limite_da_200(client, monkeypatch):
    monkeypatch.setattr(
        "app.presentacion.routers.membresias_pagos_router.LIMITE_MAXIMO_REPORTE_PAGOS", 2,
    )
    _crear_pago(client, cedula_valida(564))
    _crear_pago(client, cedula_valida(565))

    resp = client.get("/api/v1/membresias/pagos/reportes")
    assert resp.status_code == 200
    assert len(resp.json()) == 2


# --- Candado de ancho: ninguna tabla de reporte excede la página (#366) ------

# Peor caso conocido de cada reporte, con los datos que el club produce de
# verdad: nombre largo en MAYÚSCULAS (más ancho que el mismo texto en
# minúsculas) y el estado `PENDIENTE_VALIDACION`, un token de 121pt que
# ReportLab no puede partir por ningún lado.
_ESTUDIANTE_LARGO = "MARIA FERNANDA ALEJANDRA CHILIQUINGA TAMAYO DE LA TORRE"

_REPORTES_PEOR_CASO = [
    (
        "pagos",
        _COLUMNAS_PAGOS_PDF,
        [[
            _ESTUDIANTE_LARGO, "USD 1200.00", "REGULARIZACION", "01/03/2026",
            "31/03/2026", "PENDIENTE_VALIDACION", "17/08/2026",
        ]],
    ),
    (
        "personas",
        _COLUMNAS_PERSONAS_PDF,
        [[
            "MARIA FERNANDA ALEJANDRA", "CHILIQUINGA TAMAYO DE LA TORRE",
            "1710034065", "0987654321", "17/08/2026",
        ]],
    ),
    (
        "asistencias",
        _COLUMNAS_ASISTENCIA_PDF,
        [["17/08/2026", "MIERCOLES 18:00–19:30", _ESTUDIANTE_LARGO, "JUSTIFICADO"]],
    ),
]


def _reporte_construido(monkeypatch, columnas, filas):
    """Genera el reporte real y devuelve el `SimpleDocTemplate`, la `Table` y
    las celdas que `generar_reporte_pdf` armó por dentro.

    Se interceptan las dos clases en el módulo en vez de rehacer la tabla acá
    porque el desborde es invisible desde afuera: ReportLab dibuja igual una
    tabla más ancha que el frame -- sin excepción y sin warning -- y los bytes
    del PDF salen válidos. Interceptar también el documento evita copiar los
    márgenes al test: el ancho útil contra el que se mide es el que usó el
    generador, aunque mañana esos márgenes cambien.

    Las celdas se guardan tal como se le pasaron a `Table`: durante
    `doc.build`, ReportLab reemplaza cada una por su versión ya maquetada y el
    contenido original deja de estar a mano."""
    capturado: dict = {}
    documento_original = generador_pdf.SimpleDocTemplate
    tabla_original = generador_pdf.Table

    def _capturar_documento(*args, **kwargs):
        capturado["doc"] = documento_original(*args, **kwargs)
        return capturado["doc"]

    def _capturar_tabla(celdas, *args, **kwargs):
        capturado["celdas"] = celdas
        capturado["tabla"] = tabla_original(celdas, *args, **kwargs)
        return capturado["tabla"]

    monkeypatch.setattr(generador_pdf, "SimpleDocTemplate", _capturar_documento)
    monkeypatch.setattr(generador_pdf, "Table", _capturar_tabla)
    generar_reporte_pdf(titulo="Candado de ancho", columnas=columnas, filas=filas)
    return capturado["doc"], capturado["tabla"], capturado["celdas"]


@pytest.mark.parametrize(
    "reporte, columnas, filas",
    _REPORTES_PEOR_CASO,
    ids=[caso[0] for caso in _REPORTES_PEOR_CASO],
)
def test_tabla_de_reporte_no_desborda_el_ancho_de_la_pagina(
    monkeypatch, reporte, columnas, filas,
):
    """Lo que se pierde cuando la tabla desborda no es una excepción: son las
    columnas de la derecha, dibujadas fuera del papel. Y cuál se pierde
    depende del largo de los datos, así que el mismo reporte sale distinto
    según a quién liste."""
    doc, tabla, _ = _reporte_construido(monkeypatch, columnas, filas)

    ancho, _alto = tabla.wrap(doc.width, doc.height)

    assert ancho <= doc.width, (
        f"el reporte de {reporte} mide {ancho:.1f}pt dentro de un frame de "
        f"{doc.width:.1f}pt: {ancho - doc.width:.1f}pt caen fuera de la hoja"
    )


def test_encabezado_del_reporte_se_lee_blanco_sobre_el_rojo(monkeypatch):
    """El encabezado viaja como `Paragraph` para que también haga wrap, y un
    `Paragraph` pinta su propio texto: el `TEXTCOLOR` del `TableStyle` deja de
    aplicarle. Si el color no viaja en el estilo del párrafo, el título queda
    negro sobre el rojo institucional y no se lee."""
    _reporte, columnas, filas = _REPORTES_PEOR_CASO[0]
    _doc, _tabla, celdas = _reporte_construido(monkeypatch, columnas, filas)

    encabezado = celdas[0]

    assert all(isinstance(celda, Paragraph) for celda in encabezado)
    assert all(celda.style.textColor == colors.white for celda in encabezado)
