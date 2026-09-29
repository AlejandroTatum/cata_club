from datetime import datetime, timedelta, timezone

import pytest

from app.dominio.modelos import ReporteError
from app.infraestructura.repositorios.reporte_error_repositorio import ReporteErrorRepositorio

from app.servicios_negocio.reporte_error_servicio import validar_captura, validar_request_id


@pytest.mark.parametrize("mime,contenido", [
    ("image/png", b"\x89PNG\r\n\x1a\nabc"),
    ("image/jpeg", b"\xff\xd8\xffabc"),
    ("image/webp", b"RIFF\x04\x00\x00\x00WEBPabc"),
])
def test_captura_valida(mime, contenido):
    validar_captura(mime, contenido)


@pytest.mark.parametrize("mime,contenido", [
    ("image/png", b"not an image"),
    ("image/gif", b"GIF89a"),
    ("image/jpeg", b"\xff\xd8"),
    ("image/png", b"\x89PNG\r\n\x1a\n" + b"a" * (2 * 1024 * 1024)),
])
def test_captura_invalida(mime, contenido):
    with pytest.raises(ValueError):
        validar_captura(mime, contenido)


def test_reporte_sin_captura_y_request_id_invalido(client, persona_sin_usuario):
    response = client.post("/api/v1/reportes-error/", data={"descripcion": "Falla"})
    assert response.status_code == 201
    assert response.json()["captura_mime"] is None
    assert client.post("/api/v1/reportes-error/", data={"descripcion": "Falla"},
                       headers={"X-Request-ID": "incorrecto espacio"}).status_code == 422


def test_captura_falsificada_se_rechaza(client, persona_sin_usuario):
    response = client.post("/api/v1/reportes-error/", data={"descripcion": "Falla", "consentimiento_captura": "true"},
                           files={"captura": ("a.png", b"texto", "image/png")})
    assert response.status_code == 422


def test_captura_sin_consentimiento_se_rechaza(client, persona_sin_usuario):
    response = client.post("/api/v1/reportes-error/", data={"descripcion": "Falla"},
                           files={"captura": ("a.png", b"\x89PNG\r\n\x1a\nbytes", "image/png")})
    assert response.status_code == 422


def test_creacion_autenticada_y_lectura_admin(client, persona_sin_usuario):
    response = client.post(
        "/api/v1/reportes-error/", data={"descripcion": "Falla al guardar", "ruta": "/perfil", "consentimiento_captura": "true"},
        headers={"X-Request-ID": "req-123"},
        files={"captura": ("pantalla.png", b"\x89PNG\r\n\x1a\nbytes", "image/png")},
    )
    assert response.status_code == 201, response.text
    reporte_id = response.json()["id"]
    assert response.json()["request_id"] == "req-123"
    assert client.get(f"/api/v1/reportes-error/{reporte_id}").status_code == 200
    screenshot = client.get(f"/api/v1/reportes-error/{reporte_id}/captura")
    assert screenshot.status_code == 200
    assert screenshot.content.startswith(b"\x89PNG")


def test_reporte_requiere_autenticacion(client_sin_token):
    response = client_sin_token.post("/api/v1/reportes-error/", data={"descripcion": "Falla"})
    assert response.status_code in (401, 403)


def test_retencion_y_supresion_borran_con_captura(db_session, persona_sin_usuario):
    repo = ReporteErrorRepositorio(db_session)
    anterior = datetime.now(timezone.utc) - timedelta(days=91)
    repo.crear(ReporteError(persona_id=persona_sin_usuario.id, descripcion="viejo", captura=b"secret", captura_mime="image/png", fecha_creacion=anterior))
    repo.crear(ReporteError(persona_id=persona_sin_usuario.id, descripcion="nuevo", captura=b"secret", captura_mime="image/png"))
    db_session.flush()
    assert repo.purgar_anteriores(datetime.now(timezone.utc) - timedelta(days=90)) == 1
    assert len(repo.listar(0, 10)) == 1
    assert repo.borrar_por_persona(persona_sin_usuario.id) == 1
    assert repo.listar(0, 10) == []


def test_reportero_no_accede_a_bandeja_ni_captura(client_sin_permisos):
    assert client_sin_permisos.get("/api/v1/reportes-error/").status_code == 403
    assert client_sin_permisos.get("/api/v1/reportes-error/1").status_code == 403
    assert client_sin_permisos.get("/api/v1/reportes-error/1/captura").status_code == 403


def test_request_id_valido_y_rechazado():
    assert validar_request_id("abc-123_def.1") == "abc-123_def.1"
    assert validar_request_id(None) is None
    for value in ("a b", "../secret", "a" * 129):
        with pytest.raises(ValueError):
            validar_request_id(value)
