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
        json={"tipo_sangre": "O_POSITIVO", "persona_id": persona["id"], "enfermedades": ["Asma"]},
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
        json={"tipo_sangre": "O_POSITIVO", "persona_id": persona["id"], "enfermedades": []},
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
        json={"tipo_sangre": "O_POSITIVO", "persona_id": persona["id"], "enfermedades": ["Asma"]},
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
    persona = _crear_persona(client)
    resp = client.post(
        "/api/v1/fichas-medicas/",
        json={"tipo_sangre": "O_POSITIVO", "persona_id": persona["id"], "enfermedades": []},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["alergias"] is None
    assert body["contactoEmergencia"] is None
    assert body["telefonoEmergencia"] is None


def test_actualizar_datos_de_emergencia_parcial(client):
    persona = _crear_persona(client)
    client.post(
        "/api/v1/fichas-medicas/",
        json={
            "tipo_sangre": "O_POSITIVO", "persona_id": persona["id"], "enfermedades": [],
            "alergias": "Ninguna",
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
