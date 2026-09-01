"""
Tests de `scripts/diagnostico_horarios.py` — el diagnóstico de solo lectura
del eje REVISIÓN de la superficie de horarios (issue #899).

Corre FUERA de `backend/tests/` a propósito, por la misma razón que
`test_qa_verify_build_sha.py`: sin Postgres, sin `TEST_DATABASE_URL`, sin
fixtures de `conftest.py`, nada más que el módulo bajo prueba. Se invoca con
`cd backend && uv run pytest ../tests/test_diagnostico_horarios.py`
(ver `make test-diagnostico-horarios`).

Todos los bordes están mockeados (red y git): esta suite prueba la decisión
del diagnóstico y su cableado, no que el stack local esté levantado.
"""

import json
import sys
import urllib.error
from pathlib import Path
from unittest.mock import patch

RAIZ = Path(__file__).resolve().parent.parent
# `scripts/` no es un paquete instalado (ni vive bajo `backend/`), así que
# hay que sumarlo a sys.path a mano para poder importarlo por nombre.
sys.path.insert(0, str(RAIZ / "scripts"))

import diagnostico_horarios as diag  # noqa: E402


def _observacion(**overrides) -> dict:
    """Observación de revisión completa y alineada, para que cada test
    exprese SOLO el campo que está ejerciendo."""
    base = {
        "referencia_esperada": "origin/main",
        "url_salud": diag.URL_SALUD_FRONTEND,
        "sha_esperado": "aaaa111",
        "error_sha_esperado": None,
        "sha_servido": "aaaa111",
        "error_sha_servido": None,
        "sha_head_local": "aaaa111",
        "error_sha_head_local": None,
    }
    base.update(overrides)
    return base


# ─── detectar_hallazgos_de_revision() — pura, sin I/O ───────────────────────


def test_revision_alineada_no_reporta_ningun_hallazgo():
    assert diag.detectar_hallazgos_de_revision(_observacion()) == []


def test_sha_servido_distinto_reporta_revision_drift_con_esperado_y_observado():
    hallazgos = diag.detectar_hallazgos_de_revision(
        _observacion(sha_servido="bbbb222", sha_esperado="aaaa111")
    )
    assert len(hallazgos) == 1
    assert hallazgos[0]["clase"] == diag.CLASE_DERIVA
    assert hallazgos[0]["esperado"] == "aaaa111"
    assert hallazgos[0]["observado"] == "bbbb222"


def test_sha_desconocido_no_es_deriva_sino_revision_unavailable():
    """El caso que motiva la clase separada: el compose de producción NO pasa
    `BUILD_SHA` (solo `docker-compose.override.yml` lo hace), así que
    `/api/health` responde `sha: "unknown"`. Reportar eso como deriva mandaría
    al operador a perseguir un fantasma; el diagnóstico tiene que poder decir
    "no sé" en vez de adivinar."""
    hallazgos = diag.detectar_hallazgos_de_revision(
        _observacion(sha_servido=diag.SHA_AUSENTE)
    )
    assert len(hallazgos) == 1
    assert hallazgos[0]["clase"] == diag.CLASE_REVISION_INDETERMINADA
    assert hallazgos[0]["observado"] == diag.SHA_AUSENTE
    assert "BUILD_SHA" in hallazgos[0]["detalle"]


# ─── validar_url_loopback() — rechaza ANTES de tocar la red ─────────────────


def test_host_no_loopback_se_rechaza_sin_llamar_a_urlopen():
    """S5144: este diagnóstico solo habla con el stack local. Un objetivo
    típico de SSRF (el metadata endpoint interno de una nube) debe rechazarse
    antes de `urlopen`, aunque el esquema sea válido."""
    with patch("urllib.request.urlopen") as mock_urlopen:
        try:
            diag.consultar_json("http://169.254.169.254/latest/meta-data/")
        except RuntimeError as exc:
            assert "169.254.169.254" in str(exc)
        else:
            raise AssertionError("se esperaba RuntimeError ante un host no loopback")
    mock_urlopen.assert_not_called()


def test_esquema_no_http_se_rechaza_sin_llamar_a_urlopen():
    with patch("urllib.request.urlopen") as mock_urlopen:
        try:
            diag.consultar_json("ftp://localhost:3000/api/health")
        except RuntimeError as exc:
            assert "ftp://localhost:3000/api/health" in str(exc)
        else:
            raise AssertionError("se esperaba RuntimeError ante un esquema no http/https")
    mock_urlopen.assert_not_called()


def test_url_sin_esquema_se_rechaza_sin_llamar_a_urlopen():
    with patch("urllib.request.urlopen") as mock_urlopen:
        try:
            diag.consultar_json("localhost:3000/api/health")
        except RuntimeError as exc:
            assert "localhost:3000/api/health" in str(exc)
        else:
            raise AssertionError("se esperaba RuntimeError ante una URL no absoluta")
    mock_urlopen.assert_not_called()


# ─── Triangulación: fuentes que no se pueden determinar ─────────────────────


def test_frontend_inalcanzable_es_revision_unavailable_y_no_deriva():
    """El endpoint no respondió: no se sabe qué revisión corre. Reportarlo
    como deriva afirmaría un hecho que nadie observó."""
    hallazgos = diag.detectar_hallazgos_de_revision(
        _observacion(
            sha_servido=None,
            error_sha_servido="no se pudo consultar http://localhost:3000/api/health: rechazada",
        )
    )
    assert [h["clase"] for h in hallazgos] == [diag.CLASE_REVISION_INDETERMINADA]
    assert "rechazada" in hallazgos[0]["detalle"]


def test_referencia_esperada_indeterminada_es_revision_unavailable():
    """Si `git rev-parse origin/main` falla no hay contra qué comparar, así
    que tampoco se puede afirmar deriva."""
    hallazgos = diag.detectar_hallazgos_de_revision(
        _observacion(sha_esperado=None, error_sha_esperado="'git rev-parse origin/main' falló")
    )
    assert [h["clase"] for h in hallazgos] == [diag.CLASE_REVISION_INDETERMINADA]
    assert hallazgos[0]["fuente"] == "git origin/main"


def test_dos_fuentes_indeterminadas_reportan_dos_hallazgos_y_ninguna_deriva():
    """Con las dos fuentes caídas el reporte dice las dos cosas en vez de
    elegir una, y sigue sin inventar una deriva."""
    hallazgos = diag.detectar_hallazgos_de_revision(
        _observacion(
            sha_servido=None,
            error_sha_servido="frontend caído",
            sha_esperado=None,
            error_sha_esperado="git falló",
        )
    )
    assert len(hallazgos) == 2
    assert {h["clase"] for h in hallazgos} == {diag.CLASE_REVISION_INDETERMINADA}
    assert diag.CLASE_DERIVA not in {h["clase"] for h in hallazgos}


def test_head_local_distinto_no_es_un_hallazgo():
    """Trabajar en una rama es lo normal en este repo: `HEAD` es contexto del
    reporte, nunca una clase de hallazgo."""
    assert diag.detectar_hallazgos_de_revision(_observacion(sha_head_local="cccc333")) == []


# ─── Colectores: fallan fuerte, nunca en silencio ───────────────────────────


class _RespuestaFalsa:
    """Doble mínimo de la respuesta de `urlopen` como context manager."""

    def __init__(self, cuerpo: bytes):
        self._cuerpo = cuerpo

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def read(self):
        return self._cuerpo


def test_obtener_sha_servido_devuelve_el_campo_sha():
    with patch("urllib.request.urlopen", return_value=_RespuestaFalsa(b'{"sha": "aaaa111"}')):
        assert diag.obtener_sha_servido(diag.URL_SALUD_FRONTEND) == "aaaa111"


def test_obtener_sha_servido_sin_campo_sha_levanta_error_y_no_inventa_unknown():
    """"El campo no vino" y "el campo vino diciendo unknown" son problemas de
    lados distintos; traducir el primero al segundo borraría cuál es."""
    with patch("urllib.request.urlopen", return_value=_RespuestaFalsa(b'{"status": "ok"}')):
        try:
            diag.obtener_sha_servido(diag.URL_SALUD_FRONTEND)
        except RuntimeError as exc:
            assert "sha" in str(exc)
        else:
            raise AssertionError("se esperaba RuntimeError cuando falta 'sha'")


def test_consultar_json_con_cuerpo_invalido_levanta_error_nombrando_la_url():
    with patch("urllib.request.urlopen", return_value=_RespuestaFalsa(b"<html>502</html>")):
        try:
            diag.consultar_json(diag.URL_SALUD_FRONTEND)
        except RuntimeError as exc:
            assert "localhost:3000" in str(exc)
        else:
            raise AssertionError("se esperaba RuntimeError ante un cuerpo no JSON")


def test_consultar_json_con_fallo_de_red_levanta_error_nombrando_la_url():
    with patch("urllib.request.urlopen", side_effect=urllib.error.URLError("Connection refused")):
        try:
            diag.consultar_json(diag.URL_SALUD_FRONTEND)
        except RuntimeError as exc:
            assert "localhost:3000" in str(exc)
        else:
            raise AssertionError("se esperaba RuntimeError ante un fallo de red")


def test_observar_revision_captura_los_errores_sin_lanzar():
    """La recolección nunca revienta: un colector caído es un hallazgo del
    reporte, no un crash del diagnóstico."""
    with (
        patch.object(diag, "obtener_sha_servido", side_effect=RuntimeError("frontend caído")),
        patch.object(diag, "obtener_sha_git", side_effect=RuntimeError("git falló")),
    ):
        observacion = diag.observar_revision()
    assert observacion["sha_servido"] is None
    assert observacion["error_sha_servido"] == "frontend caído"
    assert observacion["error_sha_esperado"] == "git falló"


# ─── Determinismo y forma de la salida ──────────────────────────────────────


def test_el_resumen_lista_siempre_las_dos_clases_aunque_esten_en_cero():
    resumen = diag.construir_diagnostico(_observacion())["resumen"]
    assert resumen == {diag.CLASE_DERIVA: 0, diag.CLASE_REVISION_INDETERMINADA: 0}


def test_dos_corridas_con_la_misma_entrada_producen_salida_identica():
    """Determinismo: sin timestamps ni duraciones en el cuerpo, dos corridas
    equivalentes son byte a byte iguales."""
    primera = diag.construir_diagnostico(_observacion(sha_servido="bbbb222"))
    segunda = diag.construir_diagnostico(_observacion(sha_servido="bbbb222"))
    assert diag.formatear_texto(primera) == diag.formatear_texto(segunda)
    assert diag.formatear_json(primera) == diag.formatear_json(segunda)


def test_los_hallazgos_salen_ordenados_de_forma_estable():
    hallazgos = diag.detectar_hallazgos_de_revision(
        _observacion(
            sha_servido=None,
            error_sha_servido="frontend caído",
            sha_esperado=None,
            error_sha_esperado="git falló",
        )
    )
    claves = [(h["clase"], h["fuente"], h["observado"]) for h in hallazgos]
    assert claves == sorted(claves)


# ─── main() — cableado y código de salida ───────────────────────────────────


def test_main_sale_en_cero_cuando_no_hay_hallazgos(capsys):
    with patch.object(diag, "observar_revision", return_value=_observacion()):
        assert diag.main([]) == 0
    assert "Sin hallazgos" in capsys.readouterr().out


def test_main_sale_en_cero_aunque_haya_deriva(capsys):
    """Un hallazgo ES la salida esperada de un inventario, no una falla de
    proceso: el código de salida no cambia."""
    with patch.object(diag, "observar_revision", return_value=_observacion(sha_servido="bbbb222")):
        assert diag.main([]) == 0
    salida = capsys.readouterr().out
    assert diag.CLASE_DERIVA in salida
    assert "bbbb222" in salida


def test_main_sale_en_cero_aunque_toda_la_recoleccion_falle(capsys):
    with (
        patch.object(diag, "obtener_sha_servido", side_effect=RuntimeError("frontend caído")),
        patch.object(diag, "obtener_sha_git", side_effect=RuntimeError("git falló")),
    ):
        assert diag.main([]) == 0
    assert diag.CLASE_REVISION_INDETERMINADA in capsys.readouterr().out


def test_main_json_emite_json_parseable_con_las_claves_del_reporte(capsys):
    with patch.object(diag, "observar_revision", return_value=_observacion(sha_servido="bbbb222")):
        assert diag.main(["--json"]) == 0
    reporte = json.loads(capsys.readouterr().out)
    assert reporte["issue"] == 899
    assert reporte["resumen"][diag.CLASE_DERIVA] == 1
    assert reporte["hallazgos"][0]["esperado"] == "aaaa111"
    assert reporte["hallazgos"][0]["observado"] == "bbbb222"


def test_main_no_toma_la_url_de_argv():
    """S5144: la URL no es configurable por CLI. `main` siempre consulta la
    constante del módulo, sin importar qué se le pase en argv."""
    with patch.object(diag, "obtener_sha_servido", return_value="aaaa111") as mock_obtener:
        with patch.object(diag, "obtener_sha_git", return_value="aaaa111"):
            diag.main([])
    mock_obtener.assert_called_once_with(diag.URL_SALUD_FRONTEND)


def test_obtener_sha_git_no_hace_fetch():
    """El diagnóstico no muta nada, ni siquiera refs locales: la referencia
    esperada se lee tal como está en el clon."""
    with patch("subprocess.run") as mock_run:
        mock_run.return_value.returncode = 0
        mock_run.return_value.stdout = "aaaa111\n"
        diag.obtener_sha_git("origin/main")
    for llamada in mock_run.call_args_list:
        assert "fetch" not in llamada.args[0]
