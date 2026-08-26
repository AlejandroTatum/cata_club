def _crear_persona(client, cedula="1710034065"):
    return client.post(
        "/api/v1/personas/",
        json={
            "nombres": "Ana", "apellidos": "Torres", "cedula": cedula,
            "fecha_nacimiento": "2010-05-14", "telefono": "0991234567",
        },
    ).json()


def test_crear_y_obtener_ficha_medica(client):
    persona = _crear_persona(client)
    resp = client.post(
        "/api/v1/fichas-medicas/",
        json={
            "tipo_sangre": "O_POSITIVO", "persona_id": persona["id"],
            "enfermedades": ["Asma"], "telefono_emergencia": "0991112233",
        },
    )
    assert resp.status_code == 201
    assert resp.json()["tipoSangre"] == "O_POSITIVO"
    assert [e["nombreEnfermedad"] for e in resp.json()["enfermedades"]] == ["Asma"]

    resp = client.get(f"/api/v1/fichas-medicas/persona/{persona['id']}")
    assert resp.status_code == 200
    assert resp.json()["personaId"] == persona["id"]


def test_actualizar_tipo_sangre(client):
    """Gap 3: antes no existía forma de corregir la ficha médica ya creada."""
    persona = _crear_persona(client)
    client.post(
        "/api/v1/fichas-medicas/",
        json={
            "tipo_sangre": "O_POSITIVO", "persona_id": persona["id"],
            "enfermedades": [], "telefono_emergencia": "0991112233",
        },
    )

    resp = client.patch(
        f"/api/v1/fichas-medicas/persona/{persona['id']}",
        json={"tipo_sangre": "AB_NEGATIVO"},
    )
    assert resp.status_code == 200
    assert resp.json()["tipoSangre"] == "AB_NEGATIVO"


def test_actualizar_enfermedades_reemplaza_la_lista_completa(client):
    persona = _crear_persona(client)
    client.post(
        "/api/v1/fichas-medicas/",
        json={
            "tipo_sangre": "O_POSITIVO", "persona_id": persona["id"],
            "enfermedades": ["Asma"], "telefono_emergencia": "0991112233",
        },
    )

    resp = client.patch(
        f"/api/v1/fichas-medicas/persona/{persona['id']}",
        json={"enfermedades": ["Diabetes", "Hipertensión"]},
    )
    assert resp.status_code == 200
    nombres = sorted(e["nombreEnfermedad"] for e in resp.json()["enfermedades"])
    assert nombres == ["Diabetes", "Hipertensión"]

    # Confirma que "Asma" ya no quedó huérfana en la BD (cascade delete-orphan).
    resp = client.get(f"/api/v1/fichas-medicas/persona/{persona['id']}")
    nombres = [e["nombreEnfermedad"] for e in resp.json()["enfermedades"]]
    assert "Asma" not in nombres


def test_actualizar_ficha_medica_inexistente_da_404(client):
    resp = client.patch("/api/v1/fichas-medicas/persona/999", json={"tipo_sangre": "O_POSITIVO"})
    assert resp.status_code == 404


def test_actualizar_ficha_medica_requiere_admin(client_sin_permisos):
    resp = client_sin_permisos.patch(
        "/api/v1/fichas-medicas/persona/1", json={"tipo_sangre": "O_POSITIVO"}
    )
    assert resp.status_code == 403


def test_crear_ficha_medica_con_datos_de_emergencia(client):
    """Campos agregados a pedido del frontend: alergias y contacto de
    emergencia. Deben persistirse igual que tipo_sangre/enfermedades."""
    persona = _crear_persona(client)
    resp = client.post(
        "/api/v1/fichas-medicas/",
        json={
            "tipo_sangre": "O_POSITIVO", "persona_id": persona["id"], "enfermedades": [],
            "alergias": "Penicilina", "contacto_emergencia": "María Torres",
            "telefono_emergencia": "0991112233",
        },
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["alergias"] == "Penicilina"
    assert body["contactoEmergencia"] == "María Torres"
    assert body["telefonoEmergencia"] == "0991112233"


def test_crear_ficha_medica_sin_datos_de_emergencia_son_opcionales(client):
    """INVERTIDO por #643, no borrado.

    Antes este test afirmaba que los TRES campos de emergencia eran
    opcionales, incluido el teléfono. Ahora el teléfono es obligatorio y los
    otros dos siguen sin serlo, así que el candado se mueve al límite nuevo:
    alergias y el NOMBRE del contacto pueden faltar, el número no. Dejarlo
    caer habría dejado sin cobertura la mitad de la regla que NO cambió — que
    es justo la que un cambio futuro puede endurecer por descuido.
    """
    persona = _crear_persona(client)
    resp = client.post(
        "/api/v1/fichas-medicas/",
        json={
            "tipo_sangre": "O_POSITIVO", "persona_id": persona["id"], "enfermedades": [],
            "telefono_emergencia": "0991112233",
        },
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["alergias"] is None
    assert body["contactoEmergencia"] is None
    assert body["telefonoEmergencia"] == "0991112233"


def test_crear_ficha_medica_sin_telefono_de_emergencia_se_rechaza(client):
    """La otra mitad del test de arriba, que antes no existía porque el
    teléfono era opcional."""
    persona = _crear_persona(client, cedula="1710034073")
    resp = client.post(
        "/api/v1/fichas-medicas/",
        json={"tipo_sangre": "O_POSITIVO", "persona_id": persona["id"], "enfermedades": []},
    )
    assert resp.status_code == 422


def test_actualizar_datos_de_emergencia_parcial(client):
    persona = _crear_persona(client)
    client.post(
        "/api/v1/fichas-medicas/",
        json={
            "tipo_sangre": "O_POSITIVO", "persona_id": persona["id"], "enfermedades": [],
            "alergias": "Ninguna", "telefono_emergencia": "0991112233",
        },
    )

    resp = client.patch(
        f"/api/v1/fichas-medicas/persona/{persona['id']}",
        json={"contacto_emergencia": "Luis Pérez", "telefono_emergencia": "0987654321"},
    )
    assert resp.status_code == 200
    body = resp.json()
    # tipo_sangre y alergias no vinieron en el PATCH: deben quedar intactos.
    assert body["tipoSangre"] == "O_POSITIVO"
    assert body["alergias"] == "Ninguna"
    assert body["contactoEmergencia"] == "Luis Pérez"
    assert body["telefonoEmergencia"] == "0987654321"


def test_vaciar_alergias_y_contacto_los_borra(client):
    """FIC-5: el toast decía "guardado correctamente" pero el valor viejo
    sobrevivía. Enviar `null` explícito en el PATCH (a diferencia de OMITIR
    el campo, que `test_actualizar_datos_de_emergencia_parcial` ya cubre)
    debe borrar el valor -- igual que ya hace `enfermedades: []`.

    ACOTADO por #643 en exactamente un campo: el teléfono de emergencia salió
    de esta lista y tiene su propio candado en
    `test_vaciar_el_telefono_de_emergencia_ya_no_lo_borra`. FIC-5 sigue
    vigente para todo lo demás -- lo que cambió no es que borrar esté mal, es
    que ese número dejó de ser opcional.
    """
    persona = _crear_persona(client, cedula="1710034081")
    client.post(
        "/api/v1/fichas-medicas/",
        json={
            "tipo_sangre": "O_POSITIVO", "persona_id": persona["id"], "enfermedades": [],
            "alergias": "Polen", "contacto_emergencia": "Ana Torres",
            "telefono_emergencia": "0991112233",
        },
    )

    resp = client.patch(
        f"/api/v1/fichas-medicas/persona/{persona['id']}",
        json={"alergias": None, "contacto_emergencia": None},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["alergias"] is None
    assert body["contactoEmergencia"] is None

    # Confirma que no fue solo la respuesta: releer también da vacío.
    resp = client.get(f"/api/v1/fichas-medicas/persona/{persona['id']}")
    body = resp.json()
    assert body["alergias"] is None
    assert body["contactoEmergencia"] is None
    # Y el teléfono, que no se tocó, sigue donde estaba.
    assert body["telefonoEmergencia"] == "0991112233"


def test_vaciar_el_telefono_de_emergencia_ya_no_lo_borra(client):
    """INVERTIDO por #643. Este caso vivía dentro del test de arriba y
    afirmaba lo contrario: que un `null` explícito borraba el teléfono. Borrar
    ese número deja la ficha sin el único dato accionable de una emergencia,
    que es exactamente el estado que la regla prohíbe."""
    persona = _crear_persona(client, cedula="1710034099")
    client.post(
        "/api/v1/fichas-medicas/",
        json={
            "tipo_sangre": "O_POSITIVO", "persona_id": persona["id"], "enfermedades": [],
            "telefono_emergencia": "0991112233",
        },
    )

    resp = client.patch(
        f"/api/v1/fichas-medicas/persona/{persona['id']}",
        json={"telefono_emergencia": None},
    )
    assert resp.status_code == 422

    # Y no fue solo el rechazo: el valor guardado sigue intacto.
    body = client.get(f"/api/v1/fichas-medicas/persona/{persona['id']}").json()
    assert body["telefonoEmergencia"] == "0991112233"


def test_upsert_sin_tipo_sangre_es_400_y_no_nombra_el_campo_interno(client):
    """PATCH sobre una persona SIN ficha médica y sin tipo de sangre.

    Antes levantaba `EntidadNoEncontrada` -> 404, pero la persona existe y la
    ficha aún no: no es un recurso ausente, es un dato de entrada que falta,
    o sea un fallo de validación (400). Además el texto filtraba el nombre de
    la columna del backend (`tipo_sangre`) a un usuario final.
    """
    persona = _crear_persona(client, cedula="1710034073")

    resp = client.patch(
        f"/api/v1/fichas-medicas/persona/{persona['id']}",
        json={"alergias": "Polen"},
    )

    assert resp.status_code == 400
    detalle = resp.json()["detail"]
    assert "tipo_sangre" not in detalle
    assert "tipo de sangre" in detalle.lower()


# --- GET /existe (issue #362) ------------------------------------------------

def test_existe_ficha_medica_distingue_quien_tiene_ficha_de_quien_no(client):
    con_ficha = _crear_persona(client, cedula="1703620011")
    sin_ficha = _crear_persona(client, cedula="1703620029")
    client.post(
        "/api/v1/fichas-medicas/",
        json={
            "tipo_sangre": "O_POSITIVO", "persona_id": con_ficha["id"],
            "enfermedades": [], "telefono_emergencia": "0991112233",
        },
    )

    resp = client.get(
        "/api/v1/fichas-medicas/existe",
        params={"persona_ids": [con_ficha["id"], sin_ficha["id"]]},
    )

    assert resp.status_code == 200
    assert resp.json()["personaIdsConFicha"] == [con_ficha["id"]]


def test_existe_ficha_medica_sin_persona_ids_no_rompe(client):
    resp = client.get("/api/v1/fichas-medicas/existe")

    assert resp.status_code == 200
    assert resp.json()["personaIdsConFicha"] == []


def test_existe_ficha_medica_requiere_admin(client_sin_permisos):
    resp = client_sin_permisos.get("/api/v1/fichas-medicas/existe", params={"persona_ids": [1]})

    assert resp.status_code == 403
