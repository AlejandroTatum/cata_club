"""
Fuente única del conocimiento del club (issue #768).

Hasta este cambio el mismo conocimiento existía tres veces: `_FAQ_CONTENIDO`
en `chatbot_servicio.py` (2.135 caracteres), `frontend/src/app/ayuda/
faq-content.ts` (6.419 caracteres) y los atajos de `chat-quick-replies.ts`
(2.291). Nadie las sincronizaba: cambiar un horario obligaba a acordarse de
las tres, y tocar una sola dejaba al asistente contradiciendo a la página de
ayuda con total seguridad.

Estos tests cubren el lado del backend de esa unificación:

  · el archivo canónico carga y tiene la forma que ambos consumidores esperan;
  · la instantánea de conocimiento se SERIALIZA de ese archivo (el módulo que
    la generaba a mano —el chatbot, retirado— ya no existe);
  · el espejo del frontend y la instantánea de conocimiento están al día — los
    dos artefactos derivados que existen porque los contextos de build de
    Docker son `./backend` y `./frontend` por separado
    (docker-compose.override.yml), así que ningún archivo fuera de cada uno
    entra a su imagen;
  · nada de `docs/manuales/` entra al conocimiento: la página de ayuda es
    pública y sin autenticar, y ese directorio contiene una auditoría interna
    de producción con vulnerabilidades todavía abiertas.

La comprobación de divergencia contra lo que RENDERIZA la página de ayuda vive
del otro lado, en `frontend/src/app/ayuda/__tests__/knowledge-parity.test.tsx`:
compara el DOM renderizado contra los bytes exactos de la instantánea, nunca
una constante compartida contra sí misma.
"""
import json
import re
from pathlib import Path

import pytest

from app.servicios_negocio import conocimiento_club

RAIZ_REPO = Path(__file__).resolve().parents[2]
DATOS_FRONTEND = RAIZ_REPO / "frontend" / "src" / "data"
ESPEJO_FRONTEND = DATOS_FRONTEND / "club-knowledge.json"
ATAJOS_FRONTEND = DATOS_FRONTEND / "club-quick-replies.json"


@pytest.fixture(scope="module")
def conocimiento() -> dict:
    return conocimiento_club.cargar_conocimiento()


# ---------------------------------------------------------------------------
# El archivo canónico
# ---------------------------------------------------------------------------


class TestArchivoCanonico:
    def test_el_archivo_canonico_existe_y_es_json_valido(self):
        assert conocimiento_club.RUTA_CONOCIMIENTO.exists()
        json.loads(conocimiento_club.RUTA_CONOCIMIENTO.read_text(encoding="utf-8"))

    def test_tiene_las_secciones_que_ambos_consumidores_leen(self, conocimiento):
        assert set(conocimiento) == {
            "club",
            "ubicacion",
            "contacto",
            "horarios",
            "faq",
            "atajos",
            "glosario",  # snapshot fijado del glosario canónico (issue #903)
        }

    def test_la_lista_estatica_de_horarios_queda_vacia(self, conocimiento):
        # Issue #1374, cerrando la migración que #789 empezó: el catálogo
        # dinámico (`/asistencias/horarios-publicos`, administrado desde la
        # app) es la ÚNICA fuente de horarios. #789 la sacó de la landing y
        # #1374 sacó a /ayuda de esta lista; una lista estática acá sería una
        # segunda copia que nadie sincroniza con lo que el club publica.
        assert conocimiento["horarios"] == []

    def test_cada_entrada_de_faq_pregunta_y_responde(self, conocimiento):
        for seccion in conocimiento["faq"]:
            assert seccion["titulo"].strip()
            assert seccion["entradas"], seccion["titulo"]
            for entrada in seccion["entradas"]:
                assert "¿" in entrada["pregunta"]
                assert len(entrada["respuesta"]) > 20

    def test_conserva_todo_lo_que_sabia_el_bloque_que_reemplaza(self, conocimiento):
        # `_FAQ_CONTENIDO` sabía cosas que el FAQ de la web nunca tuvo. Unificar
        # no puede ser una excusa para perderlas.
        texto = conocimiento_club.texto_para_prompt(conocimiento)
        for hecho in (
            "Reportes",  # el administrador genera reportes
            "Membresías y Pagos",
            "Historial Asistencia",
            "recuperación",  # recuperación de contraseña por correo
            # ("entrenador disponible" salió con la copy aprobada en la
            # corrección C3 de #1374: la respuesta de horarios quedó corta.)
        ):
            assert hecho in texto, hecho

    def test_ningun_atajo_ofrece_una_pregunta_que_el_faq_no_conteste(self, conocimiento):
        # Un atajo que el conocimiento no puede contestar es peor que no
        # ofrecer atajo: le enseña al usuario que el asistente no sirve.
        preguntas = {
            entrada["pregunta"]
            for seccion in conocimiento["faq"]
            for entrada in seccion["entradas"]
        }
        for rol, atajos in conocimiento["atajos"].items():
            assert len(atajos) == 2, rol
            for atajo in atajos:
                assert atajo in preguntas, f"{rol}: {atajo}"

    def test_cubre_los_roles_que_el_widget_puede_recibir(self, conocimiento):
        assert set(conocimiento["atajos"]) == {
            "admin",
            "trainer",
            "representante",
            "estudiante",
            "unsupported",
        }


# ---------------------------------------------------------------------------
# El conocimiento se serializa del archivo, no se escribe a mano
# ---------------------------------------------------------------------------


class TestConocimientoSerializado:
    def test_el_prompt_no_trae_horarios_estaticos(self, conocimiento):
        # El reverso de la migración de #1374: la serialización NO puede
        # volver a listar horarios, porque la página que comparaba su tabla
        # contra estas líneas ahora lee el catálogo dinámico. Una línea con la
        # forma que `texto_para_prompt` le daba a cada horario (`- Categoría
        # (edades): días, de HH:MM a HH:MM.`) es una regresión, no un dato.
        texto = conocimiento_club.texto_para_prompt(conocimiento)
        patron = re.compile(r"^- .+ \(.+\): .+, de \d{2}:\d{2} a \d{2}:\d{2}\.$")
        for linea in texto.splitlines():
            assert patron.match(linea) is None, linea

    def test_el_texto_contiene_cada_pregunta_y_respuesta_del_faq(self, conocimiento):
        texto = conocimiento_club.texto_para_prompt(conocimiento)
        for seccion in conocimiento["faq"]:
            assert seccion["titulo"] in texto
            for entrada in seccion["entradas"]:
                assert entrada["pregunta"] in texto
                assert entrada["respuesta"] in texto

    @pytest.mark.parametrize(
        "hecho",
        [
            # Solo estaba en el FAQ de la web (`faq-content.ts`).
            "selector de estudiante",
            "Deshacer",
            "enviar otro comprobante",  # copy aprobada en la corrección C3 de #1374
            # Solo estaba en la landing.
            "0994219619",
            "Coliseo Ciudad de Loja",
            "@cataclub_tenis_de_mesa",
        ],
    )
    def test_el_conocimiento_sabe_cosas_que_antes_no_sabia(self, hecho):
        # Criterio 3 del issue original: con la unificación, la superficie
        # compartida contesta cosas que antes solo vivían en la web o en la
        # landing.
        assert hecho in conocimiento_club.texto_para_prompt(
            conocimiento_club.CONOCIMIENTO
        )

    def test_el_conocimiento_sigue_sin_mencionar_rutas_tecnicas(self, conocimiento):
        # El texto se renderiza en la página pública de ayuda: los nombres de
        # sección son los que una persona ve en el menú, nunca rutas ni URLs
        # técnicas.
        texto = conocimiento_club.texto_para_prompt(conocimiento)
        for ruta in ("/student", "/trainer", "/payments", "/groups", "/admin"):
            assert ruta not in texto, ruta


# ---------------------------------------------------------------------------
# Los dos artefactos derivados
# ---------------------------------------------------------------------------


class TestArtefactosDerivados:
    def test_la_instantanea_de_conocimiento_esta_al_dia(self):
        # `frontend` compara su DOM renderizado contra ESTOS bytes, así que una
        # instantánea vieja convertiría el guardián de divergencia en un test
        # que aprueba contenido que ya no es el vigente.
        assert conocimiento_club.RUTA_INSTANTANEA_PROMPT.exists()
        instantanea = conocimiento_club.RUTA_INSTANTANEA_PROMPT.read_text(encoding="utf-8")
        assert instantanea == conocimiento_club.texto_para_prompt(
            conocimiento_club.CONOCIMIENTO
        ), (
            "La instantánea del conocimiento quedó vieja: corré "
            "`make sync-knowledge`."
        )

    def test_el_espejo_del_frontend_es_identico_al_canonico(self):
        assert ESPEJO_FRONTEND.exists()
        assert ESPEJO_FRONTEND.read_bytes() == conocimiento_club.RUTA_CONOCIMIENTO.read_bytes(), (
            "El espejo del frontend divergió del archivo canónico: corré "
            "`make sync-knowledge`."
        )

    def test_el_recorte_de_atajos_es_el_del_archivo_canonico(self, conocimiento):
        # El widget del chat se monta en el layout raíz, así que importa un
        # recorte y no el documento entero: el bundler no descarta las claves
        # no usadas de un JSON, y el conocimiento completo terminaba en el
        # chunk compartido de todas las páginas.
        assert ATAJOS_FRONTEND.exists()
        assert json.loads(ATAJOS_FRONTEND.read_text(encoding="utf-8")) == conocimiento["atajos"], (
            "Los atajos del frontend divergieron del archivo canónico: corré "
            "`make sync-knowledge`."
        )


# ---------------------------------------------------------------------------
# Exclusión de `docs/manuales/` (criterio 5 del issue)
# ---------------------------------------------------------------------------


class TestAuditoriaExcluida:
    def test_el_conocimiento_no_trae_nada_de_la_auditoria_de_produccion(self):
        # `docs/manuales/` contiene una auditoría interna de producción con
        # fallos de seguridad, algunos abiertos. La página de ayuda es pública
        # y sin autenticar: incorporarla sería publicárselos a cualquiera que
        # la abra.
        for titulo in (
            "auditoría",
            "auditoria",
            "vulnerabilidad",
            "El problema grave",
            "Lo que queda abierto",
            "antes de desplegar",
            "staging",
        ):
            assert titulo.lower() not in conocimiento_club.texto_para_prompt(
                conocimiento_club.CONOCIMIENTO
            ).lower(), titulo

    def test_el_conocimiento_solo_lee_su_propio_archivo(self):
        # La única lectura de disco del módulo es el JSON canónico. Sin esto,
        # "no incorporamos los manuales" es una afirmación sobre el contenido
        # de hoy, no sobre lo que el código puede llegar a leer.
        fuente = Path(conocimiento_club.__file__).read_text(encoding="utf-8")
        assert "manuales" not in fuente
        assert "glob" not in fuente
        assert "open(" not in fuente
        assert fuente.count("read_text") == 1
