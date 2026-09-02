"""
Tests de `scripts/diagnostico_horarios.py` — el diagnóstico de solo lectura
de la superficie de horarios (issue #899), sobre sus dos ejes: REVISIÓN (qué
código corre) y CATÁLOGO (qué datos sirve y si llegan a la pantalla).

Corre FUERA de `backend/tests/` a propósito, por la misma razón que
`test_qa_verify_build_sha.py`: sin Postgres, sin `TEST_DATABASE_URL`, sin
fixtures de `conftest.py`, nada más que el módulo bajo prueba. Se invoca con
`cd backend && uv run pytest ../tests/test_diagnostico_horarios.py`
(ver `make test-diagnostico-horarios`).

Todos los bordes de red y git están mockeados: esta suite prueba la decisión
del diagnóstico y su cableado, no que el stack local esté levantado. La única
excepción deliberada es `conocimiento_club.json`, que se lee de verdad desde
el repo — es un archivo versionado, y leerlo real es lo que hace que el
candado de `static_schedule_authority` detecte si esa lista cambia.
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


def _todo(revision=None, bff=None, backend=None, estaticos=None) -> dict:
    """Observación completa de los dos ejes, toda sana salvo lo que el test
    reemplace explícitamente."""
    return {
        "revision": revision if revision is not None else _observacion(),
        "catalogo": {
            "bff": bff if bff is not None else _obs_catalogo([CATEGORIA_OK]),
            "backend": (
                backend
                if backend is not None
                else _obs_catalogo([CATEGORIA_OK], url=diag.URL_CATALOGO_BACKEND)
            ),
            "estaticos": (
                estaticos
                if estaticos is not None
                else {
                    "ruta": diag.RUTA_RELATIVA_CONOCIMIENTO,
                    "entradas": 0,
                    "categorias": [],
                    "error": None,
                }
            ),
        },
    }


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
    """El caso que motiva la clase separada: si `/api/health` responde
    `sha: "unknown"`, la imagen corriendo no vino de la ruta de publicación
    de CI (que desde el PR #425 pasa `BUILD_SHA=IMAGE_TAG` y, desde el
    issue #927, verifica esa revisión antes de publicar). Reportar eso como
    deriva mandaría al operador a perseguir un fantasma; el diagnóstico tiene
    que poder decir "no sé" en vez de adivinar."""
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


def test_el_resumen_lista_siempre_las_cinco_clases_aunque_esten_en_cero():
    """La forma de la salida no depende de los hallazgos: un consumidor del
    `--json` puede leer `resumen[clase]` sin chequear si la clave existe."""
    resumen = diag.construir_diagnostico(_todo())["resumen"]
    assert resumen == {
        diag.CLASE_DERIVA: 0,
        diag.CLASE_REVISION_INDETERMINADA: 0,
        diag.CLASE_DATOS_FALTANTES: 0,
        diag.CLASE_FUENTE_INDISPONIBLE: 0,
        diag.CLASE_AUTORIDAD_ESTATICA: 0,
    }


def test_dos_corridas_con_la_misma_entrada_producen_salida_identica():
    """Determinismo: sin timestamps ni duraciones en el cuerpo, dos corridas
    equivalentes son byte a byte iguales."""
    primera = diag.construir_diagnostico(_todo(revision=_observacion(sha_servido="bbbb222")))
    segunda = diag.construir_diagnostico(_todo(revision=_observacion(sha_servido="bbbb222")))
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
    with patch.object(diag, "observar", return_value=_todo()):
        assert diag.main([]) == 0
    assert "Sin hallazgos" in capsys.readouterr().out


def test_main_sale_en_cero_aunque_haya_deriva(capsys):
    """Un hallazgo ES la salida esperada de un inventario, no una falla de
    proceso: el código de salida no cambia."""
    with patch.object(diag, "observar", return_value=_todo(revision=_observacion(sha_servido="bbbb222"))):
        assert diag.main([]) == 0
    salida = capsys.readouterr().out
    assert diag.CLASE_DERIVA in salida
    assert "bbbb222" in salida


def test_main_sale_en_cero_aunque_toda_la_recoleccion_falle(capsys):
    """Con el stack entero abajo el diagnóstico igual entrega un reporte: los
    dos ejes reportan sus fuentes caídas y el proceso sale en 0."""
    with (
        patch.object(diag, "obtener_sha_servido", side_effect=RuntimeError("frontend caído")),
        patch.object(diag, "obtener_sha_git", side_effect=RuntimeError("git falló")),
        patch.object(diag, "obtener_catalogo", side_effect=RuntimeError("catálogo caído")),
    ):
        assert diag.main([]) == 0
    salida = capsys.readouterr().out
    assert diag.CLASE_REVISION_INDETERMINADA in salida
    assert diag.CLASE_FUENTE_INDISPONIBLE in salida


def test_main_json_emite_json_parseable_con_las_claves_del_reporte(capsys):
    with patch.object(diag, "observar", return_value=_todo(revision=_observacion(sha_servido="bbbb222"))):
        assert diag.main(["--json"]) == 0
    reporte = json.loads(capsys.readouterr().out)
    assert reporte["issue"] == 899
    assert reporte["resumen"][diag.CLASE_DERIVA] == 1
    assert reporte["hallazgos"][0]["esperado"] == "aaaa111"
    assert reporte["hallazgos"][0]["observado"] == "bbbb222"


def test_main_no_toma_ninguna_url_de_argv():
    """S5144: ninguna URL es configurable por CLI. `main` siempre consulta las
    constantes del módulo, sin importar qué se le pase en argv."""
    with (
        patch.object(diag, "obtener_sha_servido", return_value="aaaa111") as mock_sha,
        patch.object(diag, "obtener_sha_git", return_value="aaaa111"),
        patch.object(diag, "obtener_catalogo", return_value=[CATEGORIA_OK]) as mock_catalogo,
    ):
        diag.main([])
    mock_sha.assert_called_once_with(diag.URL_SALUD_FRONTEND)
    urls_consultadas = [llamada.args[0] for llamada in mock_catalogo.call_args_list]
    assert urls_consultadas == [diag.URL_CATALOGO_BFF, diag.URL_CATALOGO_BACKEND]


def test_obtener_sha_git_no_hace_fetch():
    """El diagnóstico no muta nada, ni siquiera refs locales: la referencia
    esperada se lee tal como está en el clon."""
    with patch("subprocess.run") as mock_run:
        mock_run.return_value.returncode = 0
        mock_run.return_value.stdout = "aaaa111\n"
        diag.obtener_sha_git("origin/main")
    for llamada in mock_run.call_args_list:
        assert "fetch" not in llamada.args[0]


# ════════════════════════════════════════════════════════════════════════════
# EJE CATÁLOGO (issue #899, PR 2)
# ════════════════════════════════════════════════════════════════════════════

BLOQUE_OK = {"days": ["LUNES", "MIERCOLES"], "startTime": "15:00", "endTime": "16:00"}
CATEGORIA_OK = {"category": "Formativo", "ages": "5 a 10 años", "blocks": [BLOQUE_OK]}


def _obs_catalogo(payload, url=None) -> dict:
    """Observación de un catálogo sano, resumida por el código de producción
    para no duplicar acá la forma del resumen."""
    return {
        "url": url or diag.URL_CATALOGO_BFF,
        "error": None,
        **diag.resumir_catalogo(payload),
    }


def _obs_catalogo_caido(error, url=None) -> dict:
    return {
        "url": url or diag.URL_CATALOGO_BFF,
        "error": error,
        "categorias": None,
        "total_categorias": None,
        "categorias_renderizables": None,
    }


# ─── Espejo de mapBlock/mapPublicSchedules (schedule-data.ts) ───────────────


def test_bloque_valido_es_renderizable():
    assert diag.bloque_renderizable(BLOQUE_OK) is True


def test_bloque_con_dia_desconocido_no_es_renderizable():
    """`mapBlock` descarta el bloque entero si un día no está en DAY_LABELS."""
    assert diag.bloque_renderizable({**BLOQUE_OK, "days": ["LUNES", "FUNDAY"]}) is False


def test_bloque_sin_dias_no_es_renderizable():
    assert diag.bloque_renderizable({**BLOQUE_OK, "days": []}) is False


def test_bloque_con_hora_mal_formada_no_es_renderizable():
    """VALID_TIME es /^\\d{2}:\\d{2}$/: "9:00" no pasa, "09:00" sí."""
    assert diag.bloque_renderizable({**BLOQUE_OK, "startTime": "9:00"}) is False
    assert diag.bloque_renderizable({**BLOQUE_OK, "startTime": "09:00"}) is True


def test_categoria_con_etiqueta_en_blanco_no_es_renderizable():
    assert diag.categoria_renderizable({**CATEGORIA_OK, "category": "   "}) is False


def test_categoria_sin_bloques_renderizables_no_es_renderizable():
    assert diag.categoria_renderizable({**CATEGORIA_OK, "blocks": [{"days": [], "startTime": "x", "endTime": "y"}]}) is False


# ─── Espejo de isPublicSchedules (route.ts) — la compuerta todo-o-nada ──────


def test_un_catalogo_bien_formado_pasa_la_compuerta_del_bff():
    assert diag.catalogo_tiene_forma_valida([CATEGORIA_OK]) is True


def test_un_bloque_sin_starttime_invalida_todo_el_catalogo():
    """`isPublicSchedules` es todo-o-nada: un bloque malo hace que el BFF
    devuelva 502 y NO se sirva ninguna categoría."""
    roto = {"category": "Infantil", "blocks": [{"days": ["LUNES"], "endTime": "16:00"}]}
    assert diag.catalogo_tiene_forma_valida([CATEGORIA_OK, roto]) is False


# ─── EL MODO SILENCIOSO: pasa la compuerta, el mapper igual lo descarta ─────


def test_un_catalogo_que_pasa_la_compuerta_del_bff_puede_no_renderizar_nada():
    """El hallazgo de más valor de #899: `isPublicSchedules` acepta days=[] y
    cualquier formato de hora, pero `mapBlock` los descarta sin avisar. El
    payload HTTP se ve sano y la landing no muestra la categoría."""
    payload = [{"category": "Infantil", "blocks": [{"days": [], "startTime": "9:00", "endTime": "10"}]}]
    assert diag.catalogo_tiene_forma_valida(payload) is True

    hallazgos = diag.detectar_hallazgos_de_catalogo(_obs_catalogo(payload))
    assert [h["clase"] for h in hallazgos] == [diag.CLASE_DATOS_FALTANTES]
    assert "Infantil" in hallazgos[0]["observado"]


def test_categoria_que_pierde_algunos_bloques_se_reporta_como_incompleta():
    payload = [{"category": "Formativo", "blocks": [BLOQUE_OK, {"days": ["FUNDAY"], "startTime": "15:00", "endTime": "16:00"}]}]
    hallazgos = diag.detectar_hallazgos_de_catalogo(_obs_catalogo(payload))
    assert [h["clase"] for h in hallazgos] == [diag.CLASE_DATOS_FALTANTES]
    assert "1 de 2" in hallazgos[0]["observado"]


# ─── missing_dynamic_data contra dynamic_source_unavailable ────────────────


def test_catalogo_sano_no_reporta_hallazgos():
    assert diag.detectar_hallazgos_de_catalogo(_obs_catalogo([CATEGORIA_OK])) == []


def test_catalogo_vacio_pero_valido_es_missing_dynamic_data():
    """Vacío-pero-válido NO es una fuente caída: el endpoint contestó bien."""
    hallazgos = diag.detectar_hallazgos_de_catalogo(_obs_catalogo([]))
    assert [h["clase"] for h in hallazgos] == [diag.CLASE_DATOS_FALTANTES]
    assert hallazgos[0]["observado"] == "0 categorías"


def test_endpoint_inalcanzable_es_dynamic_source_unavailable():
    hallazgos = diag.detectar_hallazgos_de_catalogo(_obs_catalogo_caido("Connection refused"))
    assert [h["clase"] for h in hallazgos] == [diag.CLASE_FUENTE_INDISPONIBLE]


def test_forma_invalida_es_dynamic_source_unavailable_y_nunca_missing_data():
    """Un 502 de `isPublicSchedules` significa "no sé qué hay", no "no hay
    nada". Confundirlos es el mismo error que llamar deriva a un `unknown`."""
    hallazgos = diag.detectar_hallazgos_de_catalogo(
        _obs_catalogo_caido("la respuesta no tiene la forma de PublicScheduleCategoryDTO")
    )
    assert [h["clase"] for h in hallazgos] == [diag.CLASE_FUENTE_INDISPONIBLE]
    assert diag.CLASE_DATOS_FALTANTES not in {h["clase"] for h in hallazgos}


def test_obtener_catalogo_con_forma_invalida_levanta_error_sin_devolver_vacio():
    cuerpo = b'[{"category": "Infantil", "blocks": [{"days": ["LUNES"]}]}]'
    with patch("urllib.request.urlopen", return_value=_RespuestaFalsa(cuerpo)):
        try:
            diag.obtener_catalogo(diag.URL_CATALOGO_BFF)
        except RuntimeError as exc:
            assert "forma" in str(exc)
        else:
            raise AssertionError("se esperaba RuntimeError ante una forma inválida")


# ─── static_schedule_authority — los sobrevivientes de #789 ────────────────


def test_horarios_estaticos_presentes_son_static_schedule_authority():
    observacion = {
        "ruta": diag.RUTA_RELATIVA_CONOCIMIENTO,
        "entradas": 5,
        "categorias": ["Formativo", "Infantil"],
        "error": None,
    }
    hallazgos = diag.detectar_hallazgos_estaticos(observacion)
    assert [h["clase"] for h in hallazgos] == [diag.CLASE_AUTORIDAD_ESTATICA]
    assert "5" in hallazgos[0]["observado"]
    assert "chatbot" in hallazgos[0]["detalle"]
    assert "/ayuda" in hallazgos[0]["detalle"]


def test_sin_entradas_estaticas_no_hay_hallazgo():
    """Si algún día se completa la migración de #789 el hallazgo desaparece
    solo, sin tocar este código."""
    observacion = {"ruta": diag.RUTA_RELATIVA_CONOCIMIENTO, "entradas": 0, "categorias": [], "error": None}
    assert diag.detectar_hallazgos_estaticos(observacion) == []


def test_el_diagnostico_no_repara_los_horarios_estaticos():
    """#899 excluye hacer la migración de #789: esto REPORTA, no arregla."""
    contenido_antes = Path(diag.RUTA_CONOCIMIENTO_CLUB).read_bytes()
    diag.observar_horarios_estaticos(diag.RUTA_CONOCIMIENTO_CLUB)
    assert Path(diag.RUTA_CONOCIMIENTO_CLUB).read_bytes() == contenido_antes


def test_observar_horarios_estaticos_lee_el_archivo_real_del_repo():
    observacion = diag.observar_horarios_estaticos(diag.RUTA_CONOCIMIENTO_CLUB)
    assert observacion["error"] is None
    assert observacion["entradas"] == 5
    assert observacion["ruta"] == diag.RUTA_RELATIVA_CONOCIMIENTO


def test_la_ruta_estatica_del_reporte_es_relativa_al_repo():
    """Contrato de redacción: nunca rutas absolutas en la salida."""
    assert not diag.RUTA_RELATIVA_CONOCIMIENTO.startswith("/")


def test_las_dos_bocas_del_catalogo_se_reportan_por_separado():
    """El backend puede publicar bien y el BFF no estar pasándolo (o al
    revés). Cada boca es su propia fuente, así que la divergencia se ve sin
    inventar una clase para ella."""
    diagnostico = diag.construir_diagnostico(
        _todo(backend=_obs_catalogo([], url=diag.URL_CATALOGO_BACKEND))
    )
    assert diagnostico["resumen"][diag.CLASE_DATOS_FALTANTES] == 1
    assert diag.URL_CATALOGO_BACKEND in diagnostico["hallazgos"][0]["fuente"]
    assert diag.URL_CATALOGO_BFF not in diagnostico["hallazgos"][0]["fuente"]


def test_el_reporte_no_emite_rutas_absolutas():
    """Contrato de redacción, verificado sobre el JSON entero."""
    salida = diag.formatear_json(
        diag.construir_diagnostico(
            _todo(
                estaticos=diag.observar_horarios_estaticos(diag.RUTA_CONOCIMIENTO_CLUB)
            )
        )
    )
    assert str(diag._RAIZ_REPO) not in salida
    assert "/home/" not in salida
