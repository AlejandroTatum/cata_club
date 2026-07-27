"""
Router del chatbot de FAQ (asistente de navegación de la app).

Endpoint público (sin auth): no expone datos personales ni sensibles, es un
helper estático de FAQ. Rate-limited porque cada llamada tiene costo (gateway
OpenCode Go / DeepSeek).
"""
from fastapi import APIRouter, Request

from app.presentacion.schemas.chatbot_schemas import ChatbotConsultaDTO, ChatbotRespuestaDTO
from app.servicios_negocio.chatbot_servicio import ChatbotServicio
from app.soporte_transversal.rate_limit import limiter

router = APIRouter(prefix="/chatbot", tags=["Chatbot"])

# El límite anterior ("15/minute") era decorativo: cada consulta tarda ~3-6s
# contra el gateway, así que 15 llamadas secuenciales necesitan ~60s y la
# ventana fija de un minuto rota antes de que nadie pueda agotarla. Medido: 17
# requests seguidas pasaron las 17, ninguna fue rechazada.
#
# Lo que hay que frenar no es el uso sostenido y lento de una persona (que el
# propio costo de la llamada ya acota), sino la ráfaga: un script o una pestaña
# en bucle disparando consultas en paralelo, donde el gasto se multiplica sin
# que la latencia lo contenga. De ahí una ventana corta:
#   - "4/10second": a ~4s por consulta, una persona alcanza 2-3 en 10s como
#     mucho, así que nunca lo toca; una ráfaga concurrente se corta al cuarto.
#   - "120/hour": techo de costo por IP para el uso sostenido, muy por encima
#     de cualquier sesión real de ayuda.
LIMITE_CONSULTAS = "4/10second;120/hour"


@router.post("/consultar", response_model=ChatbotRespuestaDTO)
@limiter.limit(LIMITE_CONSULTAS)
async def consultar(request: Request, datos: ChatbotConsultaDTO):
    respuesta = ChatbotServicio().consultar(datos.mensaje, datos.historial)
    return {"respuesta": respuesta}
