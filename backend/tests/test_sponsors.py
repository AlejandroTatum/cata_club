import pytest
from pydantic import ValidationError

from app.dominio.modelos import Sponsor
from app.presentacion.schemas.sponsor_schemas import SponsorCreateDTO

RUTA = "/api/v1/sponsors/"


def test_listado_de_sponsors_es_publico(client_sin_permisos, db_session):
    db_session.add(Sponsor(nombre="Municipio", logo_url="https://cdn/logo.png", logo_public_id="logo-1"))
    db_session.commit()

    response = client_sin_permisos.get(RUTA)

    assert response.status_code == 200
    cuerpo = response.json()
    assert len(cuerpo) == 1
    assert cuerpo[0]["nombre"] == "Municipio"
    assert cuerpo[0]["logoUrl"] == "https://cdn/logo.png"


def test_admin_sube_logo_jpg(client, monkeypatch):
    monkeypatch.setattr(
        "app.servicios_negocio.sponsor_servicio.subir_logo_sponsor",
        lambda contenido, public_id, content_type: f"https://cdn/{public_id}.jpg",
    )

    response = client.post(RUTA, data={"nombre": "  Municipio  "}, files={"archivo": ("logo.jpg", b"jpg", "image/jpeg")})

    assert response.status_code == 201
    assert response.json()["nombre"] == "Municipio"
    assert response.json()["logoUrl"].startswith("https://cdn/")


@pytest.mark.parametrize("nombre", ["", "   \t\n"])
def test_no_puede_crear_sponsor_con_nombre_vacio_o_solo_espacios(nombre):
    with pytest.raises(ValidationError):
        SponsorCreateDTO(nombre=nombre)


def test_admin_no_puede_subir_otro_tipo_de_archivo(client):
    response = client.post(RUTA, data={"nombre": "Municipio"}, files={"archivo": ("logo.gif", b"gif", "image/gif")})
    assert response.status_code == 400


def test_admin_elimina_logo_y_registro(client, db_session, monkeypatch):
    sponsor = Sponsor(nombre="Municipio", logo_url="https://cdn/logo.png", logo_public_id="logo-1")
    db_session.add(sponsor)
    db_session.commit()
    borrados = []
    monkeypatch.setattr("app.servicios_negocio.sponsor_servicio.eliminar_logo_sponsor", borrados.append)

    response = client.delete(f"{RUTA}{sponsor.id}")

    assert response.status_code == 204
    assert borrados == ["logo-1"]
    assert db_session.get(Sponsor, sponsor.id) is None
