"""
Tests for `scripts/qa_verify_build_sha.py` — the `make qa-up` guard that
checks the SHA served by `/api/health` against `origin/main` (issue #350): a
QA screenshot must not silently be evidence for stale code.

Runs OUTSIDE `backend/tests/` on purpose, same reason as
`test_docker_compose_config.py` and `test_alembic_cabeza_unica.py`: no
Postgres, no `conftest.py` fixtures, nothing but the guard module itself.
Invoke with `cd backend && uv run pytest ../tests/test_qa_verify_build_sha.py`
(see `make test-qa-guard`).

Every test mocks the network/git boundary (`fetch_served_sha`,
`fetch_origin_main_sha`, `is_ancestor`) — this suite proves the guard's
decision logic and wiring, not that git or the QA stack actually work.
"""

import sys
import urllib.error
from pathlib import Path
from unittest.mock import patch

RAIZ = Path(__file__).resolve().parent.parent
# `scripts/` no es un paquete instalado (ni vive bajo `backend/`), así que
# hay que sumarlo a sys.path a mano para poder importarlo por nombre.
sys.path.insert(0, str(RAIZ / "scripts"))

import qa_verify_build_sha as guard  # noqa: E402


# ─── evaluate() — pura, sin I/O ─────────────────────────────────────────────


def test_evaluate_sha_coincidente_sale_en_cero():
    mensaje, codigo = guard.evaluate("abc123", "abc123", is_ancestor_fn=lambda *_: False)
    assert codigo == 0
    assert mensaje == "QA sirve abc123, igual a origin/main."


def test_evaluate_sha_coincidente_no_consulta_is_ancestor():
    def _explota(*_args):
        raise AssertionError("is_ancestor no debería llamarse cuando los SHA coinciden")

    _, codigo = guard.evaluate("abc123", "abc123", is_ancestor_fn=_explota)
    assert codigo == 0


def test_evaluate_atras_de_origin_sale_en_uno_y_nombra_los_dos_sha():
    mensaje, codigo = guard.evaluate(
        "abc123", "def456", is_ancestor_fn=lambda candidato, ref: True
    )
    assert codigo == 1
    assert "abc123" in mensaje
    assert "def456" in mensaje
    assert "detrás" in mensaje
    assert "make qa-up" in mensaje


def test_evaluate_divergido_sale_en_uno_y_nombra_los_dos_sha():
    mensaje, codigo = guard.evaluate(
        "abc123", "def456", is_ancestor_fn=lambda candidato, ref: False
    )
    assert codigo == 1
    assert "abc123" in mensaje
    assert "def456" in mensaje
    assert "no se puede verificar" in mensaje


# ─── is_ancestor() — traduce el código de salida de git ────────────────────


def test_is_ancestor_codigo_cero_es_true():
    with patch("subprocess.run") as mock_run:
        mock_run.return_value.returncode = 0
        assert guard.is_ancestor("abc123", "origin/main") is True


def test_is_ancestor_codigo_uno_es_false():
    with patch("subprocess.run") as mock_run:
        mock_run.return_value.returncode = 1
        assert guard.is_ancestor("abc123", "origin/main") is False


def test_is_ancestor_codigo_inesperado_levanta_error():
    with patch("subprocess.run") as mock_run:
        mock_run.return_value.returncode = 128
        try:
            guard.is_ancestor("abc123", "origin/main")
        except RuntimeError:
            pass
        else:
            raise AssertionError("se esperaba RuntimeError con returncode=128")


# ─── fetch_served_sha() — falla de red o de forma explícita, nunca silente ──


def test_fetch_served_sha_devuelve_el_campo_sha():
    respuesta_falsa = _RespuestaFalsa(b'{"status": "ok", "sha": "abc123"}')
    with patch("urllib.request.urlopen", return_value=respuesta_falsa):
        assert guard.fetch_served_sha("http://localhost:3000/api/health") == "abc123"


def test_fetch_served_sha_sin_campo_sha_levanta_error_claro():
    respuesta_falsa = _RespuestaFalsa(b'{"status": "ok"}')
    with patch("urllib.request.urlopen", return_value=respuesta_falsa):
        try:
            guard.fetch_served_sha("http://localhost:3000/api/health")
        except RuntimeError as exc:
            assert "sha" in str(exc)
        else:
            raise AssertionError("se esperaba RuntimeError cuando falta 'sha'")


def test_fetch_served_sha_con_fallo_de_red_levanta_error_claro():
    with patch(
        "urllib.request.urlopen",
        side_effect=urllib.error.URLError("Connection refused"),
    ):
        try:
            guard.fetch_served_sha("http://localhost:3000/api/health")
        except RuntimeError as exc:
            assert "localhost:3000" in str(exc)
        else:
            raise AssertionError("se esperaba RuntimeError ante un fallo de red")


class _RespuestaFalsa:
    """Doble mínimo de la respuesta de `urllib.request.urlopen` como context manager."""

    def __init__(self, cuerpo: bytes):
        self._cuerpo = cuerpo

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def read(self):
        return self._cuerpo


# ─── main() — wiring y propagación de fallas ────────────────────────────────


def test_main_sale_en_cero_cuando_el_servido_coincide_con_origin(capsys):
    with (
        patch.object(guard, "fetch_served_sha", return_value="abc123"),
        patch.object(guard, "fetch_origin_main_sha", return_value="abc123"),
    ):
        codigo = guard.main([])
    assert codigo == 0
    salida = capsys.readouterr()
    assert "abc123" in salida.out


def test_main_sale_en_uno_cuando_el_servido_esta_atras_de_origin(capsys):
    with (
        patch.object(guard, "fetch_served_sha", return_value="old111"),
        patch.object(guard, "fetch_origin_main_sha", return_value="new222"),
        patch.object(guard, "is_ancestor", return_value=True),
    ):
        codigo = guard.main([])
    assert codigo == 1
    salida = capsys.readouterr()
    assert "old111" in salida.err
    assert "new222" in salida.err


def test_main_sale_en_uno_y_no_pasa_en_silencio_si_falla_fetch_served_sha(capsys):
    with patch.object(
        guard,
        "fetch_served_sha",
        side_effect=RuntimeError("no se pudo consultar http://localhost:3000/api/health"),
    ):
        codigo = guard.main([])
    assert codigo == 1
    salida = capsys.readouterr()
    assert "no se pudo consultar" in salida.err


def test_main_usa_la_url_servida_provista():
    with (
        patch.object(guard, "fetch_served_sha", return_value="abc123") as mock_fetch,
        patch.object(guard, "fetch_origin_main_sha", return_value="abc123"),
    ):
        guard.main(["--served-url", "http://qa.local/api/health"])
    mock_fetch.assert_called_once_with("http://qa.local/api/health")
