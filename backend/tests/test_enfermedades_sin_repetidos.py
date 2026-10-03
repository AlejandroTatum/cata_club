"""ADMA-30: la ficha médica no guarda enfermedades repetidas ni vacías."""
from app.servicios_negocio.dtos.persona_schemas import FichaMedicaUpdateDTO


def test_enfermedades_repetidas_o_vacias_se_descartan_conservando_el_orden():
    datos = FichaMedicaUpdateDTO(enfermedades=["Asma", "asma ", "", "  ", "Diabetes", "Asma"])

    assert datos.enfermedades == ["Asma", "Diabetes"]


def test_enfermedades_nulas_siguen_siendo_nulas():
    assert FichaMedicaUpdateDTO(enfermedades=None).enfermedades is None
