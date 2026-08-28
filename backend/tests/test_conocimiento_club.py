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
  · el prompt de sistema se SERIALIZA de ese archivo, y ya no hay una copia
    propia dentro del módulo del chatbot;
  · el espejo del frontend y la instantánea del prompt están al día — los dos
    artefactos derivados que existen porque los contextos de build de Docker
    son `./backend` y `./frontend` por separado (docker-compose.override.yml),
    así que ningún archivo fuera de cada uno entra a su imagen;
  · el tamaño del prompt queda medido y anotado, con un techo explícito;
  · nada de `docs/manuales/` entra al prompt: el endpoint del chatbot es
    público y sin autenticar, y ese directorio contiene una auditoría interna
    de producción con vulnerabilidades todavía abiertas.

La comprobación de divergencia contra lo que RENDERIZA la página de ayuda vive
del otro lado, en `frontend/src/app/ayuda/__tests__/knowledge-parity.test.tsx`:
compara el DOM renderizado contra los bytes exactos del prompt, nunca una
constante compartida contra sí misma.
"""
import json
from pathlib import Path

import pytest

from app.servicios_negocio import conocimiento_club
from app.servicios_negocio.chatbot_servicio import (
    PROMPT_SISTEMA_CARACTERES,
    PROMPT_SISTEMA_TOKENS_APROX,
    PROMPT_SISTEMA_TOKENS_MEDIDOS,
    SYSTEM_PROMPT,
    TECHO_PROMPT_SISTEMA_TOKENS,
    ChatbotServicio,
)

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
        }

    def test_lista_las_cinco_categorias_que_el_club_entrena(self, conocimiento):
        categorias = [horario["categoria"] for horario in conocimiento["horarios"]]
        assert categorias == [
            "Formativo",
            "Infantil",
            "Juvenil",
            "Competitivo",
            "Adultos",
        ]

    def test_cada_horario_dice_para_quien_que_dias_y_a_que_hora(self, conocimiento):
        for horario in conocimiento["horarios"]:
            assert set(horario) == {"categoria", "edades", "dias", "horas"}
            assert all(horario[campo].strip() for campo in horario)

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
            "entrenador disponible",  # no hay entrenadores asignados a horarios
            "recuperación",  # recuperación de contraseña por correo
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
# El prompt se serializa del archivo, no se escribe a mano
# ---------------------------------------------------------------------------


class TestPromptSerializado:
    def test_el_modulo_del_chatbot_ya_no_guarda_una_copia_del_conocimiento(self):
        fuente = Path(conocimiento_club.__file__).with_name("chatbot_servicio.py")
        assert "_FAQ_CONTENIDO" not in fuente.read_text(encoding="utf-8")

    def test_el_prompt_contiene_cada_horario_publicado(self, conocimiento):
        for horario in conocimiento["horarios"]:
            linea = next(
                (
                    fila
                    for fila in SYSTEM_PROMPT.splitlines()
                    if fila.startswith(f"- {horario['categoria']} (")
                ),
                None,
            )
            assert linea is not None, horario["categoria"]
            assert horario["edades"] in linea
            assert horario["horas"] in linea

    def test_el_prompt_contiene_cada_pregunta_y_respuesta_del_faq(self, conocimiento):
        for seccion in conocimiento["faq"]:
            assert seccion["titulo"] in SYSTEM_PROMPT
            for entrada in seccion["entradas"]:
                assert entrada["pregunta"] in SYSTEM_PROMPT
                assert entrada["respuesta"] in SYSTEM_PROMPT

    @pytest.mark.parametrize(
        "hecho",
        [
            # Solo estaba en el FAQ de la web (`faq-content.ts`).
            "selector de estudiante",
            "Deshacer",
            "subir un comprobante nuevo",
            # Solo estaba en la landing.
            "0994219619",
            "Coliseo Ciudad de Loja",
            "@cataclub_tenis_de_mesa",
        ],
    )
    def test_el_prompt_sabe_cosas_que_antes_no_sabia(self, hecho):
        # Criterio 3 del issue: el bot contesta preguntas que hoy no puede
        # porque su respuesta solo vivía en la web o en la landing.
        assert hecho in SYSTEM_PROMPT

    def test_el_conocimiento_sigue_sin_mencionar_rutas_tecnicas(self, conocimiento):
        # Regla 3 de las instrucciones: nunca rutas ni URLs de pantallas. El
        # conocimiento creció mucho; la regla no cambió. Se mira el bloque de
        # conocimiento y no el prompt entero porque las instrucciones SÍ
        # nombran rutas, como ejemplo de lo que el modelo no debe decir.
        texto = conocimiento_club.texto_para_prompt(conocimiento)
        for ruta in ("/student", "/trainer", "/payments", "/groups", "/admin"):
            assert ruta not in texto, ruta


# ---------------------------------------------------------------------------
# Los dos artefactos derivados
# ---------------------------------------------------------------------------


class TestArtefactosDerivados:
    def test_la_instantanea_del_prompt_esta_al_dia(self):
        # `frontend` compara su DOM renderizado contra ESTOS bytes, así que una
        # instantánea vieja convertiría el guardián de divergencia en un test
        # que aprueba lo que ya no se envía.
        assert conocimiento_club.RUTA_INSTANTANEA_PROMPT.exists()
        instantanea = conocimiento_club.RUTA_INSTANTANEA_PROMPT.read_text(encoding="utf-8")
        assert instantanea == SYSTEM_PROMPT, (
            "La instantánea del prompt quedó vieja: corré `make sync-knowledge`."
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
# El tamaño, medido y anotado (criterio 4 del issue)
# ---------------------------------------------------------------------------


class TestTamanioDelPrompt:
    def test_el_numero_anotado_en_el_codigo_es_el_real(self):
        # La constante es un literal a propósito: obliga a que agrandar el
        # conocimiento aparezca como un número que cambia en el diff, en vez de
        # crecer en silencio.
        assert PROMPT_SISTEMA_TOKENS_MEDIDOS == PROMPT_SISTEMA_TOKENS_APROX, (
            "El prompt cambió de tamaño: actualizá PROMPT_SISTEMA_TOKENS_MEDIDOS "
            f"a {PROMPT_SISTEMA_TOKENS_APROX}."
        )

    def test_la_medicion_se_deriva_del_prompt_que_se_envia(self):
        assert PROMPT_SISTEMA_CARACTERES == len(SYSTEM_PROMPT)
        assert PROMPT_SISTEMA_TOKENS_APROX == PROMPT_SISTEMA_CARACTERES // 4

    def test_el_prompt_no_supera_el_techo_declarado(self):
        assert PROMPT_SISTEMA_TOKENS_APROX <= TECHO_PROMPT_SISTEMA_TOKENS


# ---------------------------------------------------------------------------
# Exclusión de `docs/manuales/` (criterio 5 del issue)
# ---------------------------------------------------------------------------


class TestAuditoriaExcluida:
    def test_el_prompt_no_trae_nada_de_la_auditoria_de_produccion(self):
        # `docs/manuales/` contiene una auditoría interna de producción con
        # fallos de seguridad, algunos abiertos. El endpoint del chatbot es
        # público y sin autenticar: incorporarla sería publicárselos a
        # cualquiera que sepa preguntar.
        for titulo in (
            "auditoría",
            "auditoria",
            "vulnerabilidad",
            "El problema grave",
            "Lo que queda abierto",
            "antes de desplegar",
            "staging",
        ):
            assert titulo.lower() not in SYSTEM_PROMPT.lower(), titulo

    def test_el_conocimiento_solo_lee_su_propio_archivo(self):
        # La única lectura de disco del módulo es el JSON canónico. Sin esto,
        # "no incorporamos los manuales" es una afirmación sobre el contenido
        # de hoy, no sobre lo que el código puede llegar a leer.
        fuente = Path(conocimiento_club.__file__).read_text(encoding="utf-8")
        assert "manuales" not in fuente
        assert "glob" not in fuente
        assert "open(" not in fuente
        assert fuente.count("read_text") == 1


# ---------------------------------------------------------------------------
# El respaldo local también sale del archivo canónico
# ---------------------------------------------------------------------------


class TestRespaldoLocal:
    def test_contesta_una_pregunta_que_solo_vivia_en_el_faq_de_la_web(self):
        # Antes este respaldo tenía SU PROPIA tabla de respuestas escritas a
        # mano — una cuarta copia. Ahora devuelve la respuesta canónica, así
        # que con el proveedor caído el bot contesta algo que antes no sabía.
        respuesta = ChatbotServicio._respuesta_local(
            "Represento a más de un hijo, ¿cómo cambio entre ellos?"
        )
        assert "selector de estudiante" in respuesta

    def test_dice_donde_queda_el_club_sin_una_septima_copia_de_la_direccion(self, conocimiento):
        # La ubicación y el contacto no son una entrada del FAQ, así que el
        # respaldo los compone del archivo canónico en vez de tener su propia
        # redacción de la dirección.
        respuesta = ChatbotServicio._respuesta_local("¿A qué número de WhatsApp escribo?")
        assert conocimiento["contacto"]["whatsapp"][0] in respuesta
        assert conocimiento["ubicacion"]["direccion"] in respuesta

    def test_avisa_siempre_que_el_asistente_externo_no_esta(self):
        respuesta = ChatbotServicio._respuesta_local("¿cómo inicio sesión?")
        assert respuesta.startswith("El asistente externo no está disponible")

    def test_no_inventa_cuando_no_sabe(self):
        respuesta = ChatbotServicio._respuesta_local("¿quién ganó el mundial de 1986?")
        assert "contacte a un administrador" in respuesta.lower()
