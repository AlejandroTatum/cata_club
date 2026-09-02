"""
Issue #643 — una ficha médica completa exige tipo de sangre y teléfono de
emergencia válidos.

Qué NO se vuelve obligatorio, y está probado acá para que nadie lo promueva
después sin darse cuenta: alergias, enfermedades y `contacto_emergencia` (el
NOMBRE de quien contactar). Sobre este último ver
`test_el_nombre_del_contacto_sigue_siendo_opcional_en_la_ficha_general` y su
par en el camino de enrollment: las dos mitades de una decisión deliberada.

Los registros LEGADOS se siembran por `db_session` + ORM, nunca por la API:
una vez que la regla existe, la API ya no puede crear una fila inválida, así
que la única forma de tener una es escribirla directo. Además el par
`client`/`client_sin_token` comparte `dependency_overrides`, y sembrar con uno
para leer con el otro da un 401 en silencio; acá `client` depende de
`db_session`, así que ambos ven la misma transacción.
"""
from datetime import date

import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.enums import TipoSangre
from app.dominio.modelos import FichaMedica, Persona


# ---------------------------------------------------------------------------
# Fábricas ORM
# ---------------------------------------------------------------------------

def _persona(db_session, sufijo: int) -> Persona:
    persona = Persona(
        nombres="Ana", apellidos=f"Torres{sufijo}", cedula=cedula_valida(700 + sufijo),
        fecha_nacimiento=date(2010, 5, 14), telefono="0991234567",
    )
    db_session.add(persona)
    db_session.commit()
    db_session.refresh(persona)
    return persona


def _ficha_legada(db_session, persona: Persona, **overrides) -> FichaMedica:
    """Una ficha como las que existían ANTES de #643.

    Se escribe por ORM a propósito: es exactamente la fila que ninguna
    migración puede completar sin inventar un dato, y que la API ya no acepta
    crear. Los defaults reproducen el peor caso real — tipo de sangre
    `DESCONOCIDO` y sin teléfono.
    """
    campos = {
        "tipo_sangre": TipoSangre.DESCONOCIDO,
        "persona_id": persona.id,
        "alergias": None,
        "contacto_emergencia": None,
        "telefono_emergencia": None,
    }
    campos.update(overrides)
    ficha = FichaMedica(**campos)
    db_session.add(ficha)
    db_session.commit()
    db_session.refresh(ficha)
    return ficha


def _ficha_valida(db_session, persona: Persona) -> FichaMedica:
    return _ficha_legada(
        db_session, persona,
        tipo_sangre=TipoSangre.O_POSITIVO,
        contacto_emergencia="Ana Torres",
        telefono_emergencia="0991112233",
    )


def _cuerpo_creacion(persona_id: int, **overrides) -> dict:
    cuerpo = {
        "tipo_sangre": "O_POSITIVO",
        "persona_id": persona_id,
        "enfermedades": [],
        "telefono_emergencia": "0991112233",
    }
    cuerpo.update(overrides)
    return cuerpo


def _tiene_ficha(db_session, persona_id: int) -> bool:
    return db_session.query(FichaMedica).filter(
        FichaMedica.persona_id == persona_id
    ).count() > 0


# ---------------------------------------------------------------------------
# Creación completa — tipo de sangre
# ---------------------------------------------------------------------------

def test_crear_ficha_con_tipo_de_sangre_desconocido_se_rechaza(client, db_session):
    persona = _persona(db_session, 1)

    resp = client.post(
        "/api/v1/fichas-medicas/",
        json=_cuerpo_creacion(persona.id, tipo_sangre="DESCONOCIDO"),
    )

    assert resp.status_code == 422
    assert not _tiene_ficha(db_session, persona.id)


def test_crear_ficha_sin_tipo_de_sangre_se_rechaza(client, db_session):
    persona = _persona(db_session, 2)
    cuerpo = _cuerpo_creacion(persona.id)
    del cuerpo["tipo_sangre"]

    resp = client.post("/api/v1/fichas-medicas/", json=cuerpo)

    assert resp.status_code == 422
    assert not _tiene_ficha(db_session, persona.id)


def test_el_rechazo_del_tipo_de_sangre_se_explica_en_castellano(client, db_session):
    """Un mensaje en inglés de Pydantic no pasa el filtro `isUserFacingText`
    del frontend, así que el usuario no lo lee: sería una regla que rechaza en
    silencio. Mismo motivo por el que cédula y teléfono ya usan un
    `AfterValidator` con texto propio en vez de una constraint de `Field`."""
    persona = _persona(db_session, 3)

    resp = client.post(
        "/api/v1/fichas-medicas/",
        json=_cuerpo_creacion(persona.id, tipo_sangre="DESCONOCIDO"),
    )

    assert "tipo de sangre" in resp.text.lower()


# ---------------------------------------------------------------------------
# Creación completa — teléfono de emergencia
# ---------------------------------------------------------------------------

def test_crear_ficha_sin_telefono_de_emergencia_se_rechaza(client, db_session):
    persona = _persona(db_session, 4)
    cuerpo = _cuerpo_creacion(persona.id)
    del cuerpo["telefono_emergencia"]

    resp = client.post("/api/v1/fichas-medicas/", json=cuerpo)

    assert resp.status_code == 422
    assert not _tiene_ficha(db_session, persona.id)


@pytest.mark.parametrize("telefono", ["", "   ", "123", "0991abc233", "999999999999"])
def test_crear_ficha_con_telefono_de_emergencia_invalido_se_rechaza(
    client, db_session, telefono,
):
    persona = _persona(db_session, 5)

    resp = client.post(
        "/api/v1/fichas-medicas/",
        json=_cuerpo_creacion(persona.id, telefono_emergencia=telefono),
    )

    assert resp.status_code == 422
    assert not _tiene_ficha(db_session, persona.id)


def test_crear_ficha_con_telefono_nulo_se_rechaza(client, db_session):
    persona = _persona(db_session, 6)

    resp = client.post(
        "/api/v1/fichas-medicas/",
        json=_cuerpo_creacion(persona.id, telefono_emergencia=None),
    )

    assert resp.status_code == 422
    assert not _tiene_ficha(db_session, persona.id)


@pytest.mark.parametrize("telefono", ["0991112233", "042345678"])
def test_crear_ficha_acepta_celular_y_fijo(client, db_session, telefono):
    """La regla telefónica vigente (`es_telefono_valido`) admite las dos
    formas; #643 la reusa, no la reescribe más estricta."""
    persona = _persona(db_session, 7)

    resp = client.post(
        "/api/v1/fichas-medicas/",
        json=_cuerpo_creacion(persona.id, telefono_emergencia=telefono),
    )

    assert resp.status_code == 201
    assert resp.json()["telefonoEmergencia"] == telefono


# ---------------------------------------------------------------------------
# Lo que sigue siendo opcional
# ---------------------------------------------------------------------------

def test_alergias_y_enfermedades_siguen_siendo_opcionales(client, db_session):
    persona = _persona(db_session, 8)

    resp = client.post("/api/v1/fichas-medicas/", json=_cuerpo_creacion(persona.id))

    assert resp.status_code == 201
    assert resp.json()["alergias"] is None
    assert resp.json()["enfermedades"] == []


def test_el_nombre_del_contacto_sigue_siendo_opcional_en_la_ficha_general(
    client, db_session,
):
    """DECISIÓN #643, mitad A. `contacto_emergencia` NO se vuelve obligatorio
    acá: el issue lo prohíbe salvo necesidad ya establecida por el dominio, y
    en este DTO no la hay. Su mitad B vive en
    `test_el_nombre_del_contacto_si_es_obligatorio_en_enrollment`, donde la
    necesidad SÍ estaba establecida desde antes de este issue."""
    persona = _persona(db_session, 9)
    cuerpo = _cuerpo_creacion(persona.id)
    assert "contacto_emergencia" not in cuerpo

    resp = client.post("/api/v1/fichas-medicas/", json=cuerpo)

    assert resp.status_code == 201
    assert resp.json()["contactoEmergencia"] is None


# ---------------------------------------------------------------------------
# PATCH: sigue siendo parcial, pero no puede dejar la ficha inválida
# ---------------------------------------------------------------------------

def test_patch_sigue_siendo_parcial_sobre_una_ficha_valida(client, db_session):
    """El candado del OTRO lado: #643 no puede convertir el PATCH en un PUT.
    Un campo que no viene queda intacto."""
    persona = _persona(db_session, 10)
    _ficha_valida(db_session, persona)

    resp = client.patch(
        f"/api/v1/fichas-medicas/persona/{persona.id}", json={"alergias": "Polen"},
    )

    assert resp.status_code == 200
    cuerpo = resp.json()
    assert cuerpo["alergias"] == "Polen"
    assert cuerpo["tipoSangre"] == "O_POSITIVO"
    assert cuerpo["telefonoEmergencia"] == "0991112233"


def test_patch_no_puede_poner_el_tipo_de_sangre_en_desconocido(client, db_session):
    persona = _persona(db_session, 11)
    _ficha_valida(db_session, persona)

    resp = client.patch(
        f"/api/v1/fichas-medicas/persona/{persona.id}", json={"tipo_sangre": "DESCONOCIDO"},
    )

    assert resp.status_code == 422
    db_session.expire_all()
    assert persona.ficha_medica.tipo_sangre == TipoSangre.O_POSITIVO


def test_patch_no_puede_borrar_el_telefono_de_emergencia(client, db_session):
    """FIC-5 dejó que un `null` explícito BORRARA el campo, y para alergias y
    contacto eso sigue bien. Para el teléfono ya no: borrarlo es borrar el
    único número al que el club llamaría, y deja la ficha exactamente en el
    estado que #643 prohíbe."""
    persona = _persona(db_session, 12)
    _ficha_valida(db_session, persona)

    resp = client.patch(
        f"/api/v1/fichas-medicas/persona/{persona.id}", json={"telefono_emergencia": None},
    )

    assert resp.status_code == 422
    db_session.expire_all()
    assert persona.ficha_medica.telefono_emergencia == "0991112233"


@pytest.mark.parametrize("telefono", ["", "   ", "123", "0991abc233"])
def test_patch_no_puede_poner_un_telefono_invalido(client, db_session, telefono):
    persona = _persona(db_session, 13)
    _ficha_valida(db_session, persona)

    resp = client.patch(
        f"/api/v1/fichas-medicas/persona/{persona.id}",
        json={"telefono_emergencia": telefono},
    )

    assert resp.status_code == 422
    db_session.expire_all()
    assert persona.ficha_medica.telefono_emergencia == "0991112233"


# ---------------------------------------------------------------------------
# Issue #860 — el teléfono de emergencia no puede repetir el personal
#
# `FichaMedicaCreateDTO`/`FichaMedicaUpdateDTO` no llevan el teléfono
# personal en el payload -- solo `persona_id` (creación) o el id de la URL
# (PATCH) -- así que el DTO no puede comparar por sí solo. El candado real
# vive en `FichaMedicaServicio`, contra el `Persona.telefono` ya guardado, y
# es lo que estos tests custodian: evadir el DTO (esta ruta SIEMPRE lo evade,
# es su forma normal de uso) no evade la regla.
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("via", ["post", "patch"])
def test_crear_ficha_rechaza_telefono_emergencia_igual_al_personal(client, db_session, via):
    """Cubre los dos caminos que CREAN una ficha -- `POST /fichas-medicas/`
    y el upsert de `PATCH .../persona/{id}` sobre una persona que todavía no
    tiene ficha -- porque el candado del #860 vive en el mismo lugar
    (`FichaMedicaServicio`) para los dos."""
    persona = _persona(db_session, 30 if via == "post" else 31)

    if via == "post":
        resp = client.post(
            "/api/v1/fichas-medicas/",
            json=_cuerpo_creacion(persona.id, telefono_emergencia=persona.telefono),
        )
    else:
        resp = client.patch(
            f"/api/v1/fichas-medicas/persona/{persona.id}",
            json={"tipo_sangre": "O_POSITIVO", "telefono_emergencia": persona.telefono},
        )

    assert resp.status_code == 400
    assert not _tiene_ficha(db_session, persona.id)


def test_patch_rechaza_telefono_emergencia_igual_al_personal_sobre_ficha_existente(client, db_session):
    persona = _persona(db_session, 32)
    _ficha_valida(db_session, persona)

    resp = client.patch(
        f"/api/v1/fichas-medicas/persona/{persona.id}",
        json={"telefono_emergencia": persona.telefono},
    )

    assert resp.status_code == 400
    db_session.expire_all()
    # La ficha no queda a medio escribir: conserva el valor que tenía.
    assert persona.ficha_medica.telefono_emergencia == "0991112233"


def test_crear_ficha_acepta_cuando_la_persona_no_tiene_telefono_personal(client, db_session):
    """Issue #860: el teléfono personal es opcional en la fila (`Persona.
    telefono` tolera `""`, ver `_exigir_telefono_valido`). Sin uno con qué
    comparar, la regla no bloquea nada."""
    persona = Persona(
        nombres="Ana", apellidos="SinTelefono", cedula=cedula_valida(760),
        fecha_nacimiento=date(2010, 5, 14), telefono="",
    )
    db_session.add(persona)
    db_session.commit()
    db_session.refresh(persona)

    resp = client.post(
        "/api/v1/fichas-medicas/",
        json=_cuerpo_creacion(persona.id),
    )

    assert resp.status_code == 201


def test_patch_si_puede_borrar_alergias_y_el_nombre_del_contacto(client, db_session):
    """FIC-5 intacto donde sigue valiendo: estos dos son opcionales, así que
    vaciarlos es una operación legítima y `null` la expresa."""
    persona = _persona(db_session, 14)
    _ficha_valida(db_session, persona)
    client.patch(f"/api/v1/fichas-medicas/persona/{persona.id}", json={"alergias": "Polen"})

    resp = client.patch(
        f"/api/v1/fichas-medicas/persona/{persona.id}",
        json={"alergias": None, "contacto_emergencia": None},
    )

    assert resp.status_code == 200
    assert resp.json()["alergias"] is None
    assert resp.json()["contactoEmergencia"] is None


# ---------------------------------------------------------------------------
# PATCH sobre registros LEGADOS
# ---------------------------------------------------------------------------

def test_una_ficha_legada_se_sigue_leyendo(client, db_session):
    """Sin migración: la fila queda tal cual quedó. Leerla nunca fue el
    problema, y romper la lectura sería inventar un daño nuevo."""
    persona = _persona(db_session, 15)
    _ficha_legada(db_session, persona)

    resp = client.get(f"/api/v1/fichas-medicas/persona/{persona.id}")

    assert resp.status_code == 200
    assert resp.json()["tipoSangre"] == "DESCONOCIDO"
    assert resp.json()["telefonoEmergencia"] is None


def test_un_patch_parcial_no_puede_dejar_una_ficha_legada_invalida(client, db_session):
    """El corazón del criterio. Tocar solo las alergias de una ficha legada
    la dejaría persistida sin tipo de sangre real ni teléfono — es decir,
    exactamente el estado prohibido, escrito por una operación nueva. El PATCH
    sigue siendo parcial; lo que se exige es el resultado, no el payload."""
    persona = _persona(db_session, 16)
    _ficha_legada(db_session, persona)

    resp = client.patch(
        f"/api/v1/fichas-medicas/persona/{persona.id}", json={"alergias": "Polen"},
    )

    assert resp.status_code == 400
    db_session.expire_all()
    assert persona.ficha_medica.alergias is None


def test_el_rechazo_de_una_ficha_legada_nombra_lo_que_falta(client, db_session):
    """Y no la columna interna: el texto lo lee un administrador, no un DBA."""
    persona = _persona(db_session, 17)
    _ficha_legada(db_session, persona)

    resp = client.patch(
        f"/api/v1/fichas-medicas/persona/{persona.id}", json={"alergias": "Polen"},
    )

    detalle = resp.text.lower()
    assert "tipo de sangre" in detalle
    assert "teléfono" in detalle
    assert "tipo_sangre" not in detalle
    assert "telefono_emergencia" not in detalle


def test_una_ficha_legada_se_completa_en_un_solo_patch(client, db_session):
    """La ruta de backfill que reemplaza a la migración: la aporta una persona
    que conoce el dato, no un `UPDATE` que lo inventa."""
    persona = _persona(db_session, 18)
    _ficha_legada(db_session, persona)

    resp = client.patch(
        f"/api/v1/fichas-medicas/persona/{persona.id}",
        json={"tipo_sangre": "B_POSITIVO", "telefono_emergencia": "0991112233"},
    )

    assert resp.status_code == 200
    assert resp.json()["tipoSangre"] == "B_POSITIVO"
    assert resp.json()["telefonoEmergencia"] == "0991112233"


def test_una_ficha_legada_a_medio_completar_sigue_rechazada(client, db_session):
    """Aportar solo la mitad no alcanza: el resultado sigue siendo inválido."""
    persona = _persona(db_session, 19)
    _ficha_legada(db_session, persona)

    resp = client.patch(
        f"/api/v1/fichas-medicas/persona/{persona.id}", json={"tipo_sangre": "B_POSITIVO"},
    )

    assert resp.status_code == 400
    db_session.expire_all()
    assert persona.ficha_medica.tipo_sangre == TipoSangre.DESCONOCIDO


def test_una_ficha_legada_solo_sin_telefono_tambien_se_completa(client, db_session):
    """La otra forma de legado: tipo de sangre real, teléfono nunca cargado
    (las tres columnas de emergencia nacieron `nullable=True`)."""
    persona = _persona(db_session, 20)
    _ficha_legada(db_session, persona, tipo_sangre=TipoSangre.A_NEGATIVO)

    rechazo = client.patch(
        f"/api/v1/fichas-medicas/persona/{persona.id}", json={"alergias": "Polen"},
    )
    assert rechazo.status_code == 400

    ok = client.patch(
        f"/api/v1/fichas-medicas/persona/{persona.id}",
        json={"alergias": "Polen", "telefono_emergencia": "0991112233"},
    )
    assert ok.status_code == 200
    assert ok.json()["alergias"] == "Polen"


# ---------------------------------------------------------------------------
# Upsert por PATCH (la persona existe, la ficha todavía no)
# ---------------------------------------------------------------------------

def test_el_upsert_por_patch_exige_tambien_el_telefono(client, db_session):
    """El upsert CREA una ficha, así que crea una completa o no crea nada.
    Antes solo exigía el tipo de sangre."""
    persona = _persona(db_session, 21)

    resp = client.patch(
        f"/api/v1/fichas-medicas/persona/{persona.id}", json={"tipo_sangre": "O_POSITIVO"},
    )

    assert resp.status_code == 400
    assert not _tiene_ficha(db_session, persona.id)


def test_el_upsert_por_patch_crea_una_ficha_completa(client, db_session):
    persona = _persona(db_session, 22)

    resp = client.patch(
        f"/api/v1/fichas-medicas/persona/{persona.id}",
        json={"tipo_sangre": "O_POSITIVO", "telefono_emergencia": "0991112233"},
    )

    assert resp.status_code == 201 or resp.status_code == 200
    assert _tiene_ficha(db_session, persona.id)


# ---------------------------------------------------------------------------
# Los caminos de enrollment
# ---------------------------------------------------------------------------
#
# `EnrollmentFichaMedicaDTO` lo consumen TRES servicios —
# `enrollment_servicio` (alta pública), `persona_servicio` (representados) y
# `admin_cuenta_servicio` (alta por admin) — así que la regla entra una vez y
# vale en los tres. Se prueban los tres igual: un DTO compartido es
# exactamente la clase de cosa que alguien reescribe creyendo que solo la usa
# un camino.

def _dto_ficha_enrollment(**overrides) -> dict:
    cuerpo = {
        "tipo_sangre": "O_POSITIVO",
        "enfermedades": [],
        "contacto_emergencia": "María Torres",
        "telefono_emergencia": "0991112233",
    }
    cuerpo.update(overrides)
    return cuerpo


def test_enrollment_rechaza_tipo_de_sangre_desconocido():
    from pydantic import ValidationError

    from app.servicios_negocio.dtos.enrollment_schemas import EnrollmentFichaMedicaDTO

    with pytest.raises(ValidationError):
        EnrollmentFichaMedicaDTO(**_dto_ficha_enrollment(tipo_sangre="DESCONOCIDO"))


def test_enrollment_ya_no_asume_desconocido_cuando_falta_el_tipo_de_sangre():
    """El default era la evidencia nombrada en el issue: un alta que no elegía
    tipo de sangre quedaba grabada como `DESCONOCIDO` sin que nadie lo pidiera.
    Ahora la ausencia es un rechazo, no una suposición."""
    from pydantic import ValidationError

    from app.servicios_negocio.dtos.enrollment_schemas import EnrollmentFichaMedicaDTO

    cuerpo = _dto_ficha_enrollment()
    del cuerpo["tipo_sangre"]

    with pytest.raises(ValidationError):
        EnrollmentFichaMedicaDTO(**cuerpo)


@pytest.mark.parametrize("telefono", ["", "   ", "123", "0991abc233"])
def test_enrollment_rechaza_un_telefono_de_emergencia_invalido(telefono):
    from pydantic import ValidationError

    from app.servicios_negocio.dtos.enrollment_schemas import EnrollmentFichaMedicaDTO

    with pytest.raises(ValidationError):
        EnrollmentFichaMedicaDTO(**_dto_ficha_enrollment(telefono_emergencia=telefono))


def test_el_nombre_del_contacto_si_es_obligatorio_en_enrollment():
    """DECISIÓN #643, mitad B. Acá `contacto_emergencia` SÍ es obligatorio, y
    lo era desde antes de este issue (`Field(..., min_length=1)`, y los tres
    asistentes del frontend ya lo validaban con `personNameRule`). Es la
    "necesidad ya establecida por el dominio" que el issue manda conservar, no
    una que #643 agregue. La diferencia con la ficha general es deliberada y
    queda cubierta en los dos lados."""
    from pydantic import ValidationError

    from app.servicios_negocio.dtos.enrollment_schemas import EnrollmentFichaMedicaDTO

    cuerpo = _dto_ficha_enrollment()
    del cuerpo["contacto_emergencia"]

    with pytest.raises(ValidationError):
        EnrollmentFichaMedicaDTO(**cuerpo)


def test_enrollment_deja_opcionales_alergias_y_enfermedades():
    from app.servicios_negocio.dtos.enrollment_schemas import EnrollmentFichaMedicaDTO

    dto = EnrollmentFichaMedicaDTO(
        tipo_sangre="O_POSITIVO",
        contacto_emergencia="María Torres",
        telefono_emergencia="0991112233",
    )

    assert dto.alergias is None
    assert dto.enfermedades == []


def test_enrollment_acepta_una_ficha_completa():
    from app.servicios_negocio.dtos.enrollment_schemas import EnrollmentFichaMedicaDTO

    dto = EnrollmentFichaMedicaDTO(**_dto_ficha_enrollment())

    assert dto.tipo_sangre == TipoSangre.O_POSITIVO
    assert dto.telefono_emergencia == "0991112233"


def test_el_alta_de_un_representado_rechaza_desconocido(client, db_session):
    """`RepresentadoCreateDTO.ficha_medica` reusa el mismo DTO: el camino de
    `/student/add-dependent`."""
    representante = _persona(db_session, 30)

    resp = client.post(
        f"/api/v1/personas/{representante.id}/representados",
        json={
            "nombres": "Hijo", "apellidos": "Torres", "cedula": cedula_valida(731),
            "fecha_nacimiento": "2015-03-02", "telefono": "0991234567",
            "ficha_medica": _dto_ficha_enrollment(tipo_sangre="DESCONOCIDO"),
        },
    )

    assert resp.status_code == 422


def test_el_alta_de_un_representado_rechaza_un_telefono_invalido(client, db_session):
    representante = _persona(db_session, 31)

    resp = client.post(
        f"/api/v1/personas/{representante.id}/representados",
        json={
            "nombres": "Hijo", "apellidos": "Torres", "cedula": cedula_valida(732),
            "fecha_nacimiento": "2015-03-02", "telefono": "0991234567",
            "ficha_medica": _dto_ficha_enrollment(telefono_emergencia="123"),
        },
    )

    assert resp.status_code == 422


def test_el_alta_de_un_representado_acepta_una_ficha_completa(client, db_session):
    representante = _persona(db_session, 32)

    resp = client.post(
        f"/api/v1/personas/{representante.id}/representados",
        json={
            "nombres": "Hijo", "apellidos": "Torres", "cedula": cedula_valida(733),
            "fecha_nacimiento": "2015-03-02", "telefono": "0991234567",
            "ficha_medica": _dto_ficha_enrollment(),
        },
    )

    assert resp.status_code == 201


def test_el_alta_por_admin_rechaza_desconocido(db_session):
    """`AdminCrearCuentaDTO.ficha_medica` reusa el mismo DTO otra vez."""
    from pydantic import ValidationError

    from app.servicios_negocio.dtos.admin_cuenta_schemas import AdminCrearCuentaDTO

    with pytest.raises(ValidationError):
        AdminCrearCuentaDTO(
            tipo_cuenta="JUGADOR", nombres="Ana", apellidos="Torres",
            cedula=cedula_valida(740), fecha_nacimiento="1990-01-01",
            telefono="0991234567", correo="ana740@cataclub.test",
            contrasenia="password8",
            ficha_medica=_dto_ficha_enrollment(tipo_sangre="DESCONOCIDO"),
        )
