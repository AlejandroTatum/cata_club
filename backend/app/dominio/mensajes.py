"""
Textos de dominio que llegan tal cual al usuario final.

Viven aquí, y no incrustados en cada servicio, porque su redacción es una
decisión de negocio (qué se le puede contar a quién), no un detalle de
implementación de un servicio en particular.
"""

# Respuesta única para "esta identidad ya está registrada" en todo flujo que
# NO sea el panel de administración.
#
# Antes cada caso respondía con su propio texto —"Ya existe una persona con la
# cédula 0102030499", "El correo del representante ya está en uso"— en
# endpoints públicos y sin autenticar (inscripción, registro). El identificador
# lo escribía quien enviaba el formulario, pero la respuesta CONFIRMABA que esa
# cédula (o ese correo) pertenece a alguien del club: bastaba con sondear
# cédulas para reconstruir el padrón. El club custodia datos de menores de un
# municipio, así que ese oráculo de enumeración no es aceptable.
#
# Un único texto para cédula y para correo es deliberado: si difirieran,
# cada uno sería un oráculo del otro (el atacante sabría cuál de los dos campos
# acertó). Tampoco repite el identificador recibido.
#
# Issue #999: el texto SÍ nombra el CONJUNTO de campos que pueden chocar
# ("cédula o correo"), y eso no reabre el oráculo. La distinción es entre
# nombrar el conjunto y nombrar el elemento: quien ataca ya sabe que el
# conjunto es ese (son los dos únicos campos que este formulario pide y
# valida como identidad); lo único que el mensaje sigue sin decir es CUÁL de
# los dos coincidió, que es el dato que de verdad permitiría sondear el
# padrón. Antes de este cambio el mensaje no nombraba ningún campo, y quien
# se inscribía corregía el único que creía culpable, chocaba con el otro y
# leía el mismo texto: la corrección parecía ignorada.
#
# El frontend detecta este texto para ofrecer "Iniciar sesión" / "Recuperar
# contraseña" (`frontend/src/lib/duplicate-identity.ts`); cambiarlo aquí sin
# actualizar ese archivo rompe esa salida, y por eso hay un test que lo fija
# (`tests/test_mensajes_identidad_duplicada.py`).
MENSAJE_IDENTIDAD_DUPLICADA = (
    "Alguno de los datos ingresados, cédula o correo, ya pertenece a una "
    "cuenta registrada."
)

# INS-2 (docs/product/decisiones-de-negocio-2026-08-11.md §1, guardarraíl 3): respuesta
# única para "esta cédula no se puede vincular a su cuenta", sin importar el
# motivo real -- que no exista ninguna Persona con esa cédula, que exista pero
# sea mayor de edad, que ya esté vinculada a este mismo representante, o que
# sea la cédula del propio representante. Los cuatro casos devuelven el MISMO
# texto y el MISMO código HTTP.
#
# Es el mismo razonamiento que ya rige `MENSAJE_IDENTIDAD_DUPLICADA` arriba,
# aplicado al sentido inverso: ahí el riesgo era confirmar que una cédula
# NUEVA ya pertenece a alguien; acá es confirmar que una cédula EXISTENTE
# pertenece (o no) a un menor concreto, o revelar por qué el club no la deja
# vincular. Sin un único texto, el formulario de vinculación sería un
# buscador de cédulas de menores -- justo el guardarraíl que la decisión de
# negocio exige.
MENSAJE_VINCULACION_NO_DISPONIBLE = (
    "No fue posible vincular esa cédula a su cuenta. Verifique el número e "
    "intente nuevamente."
)

# Issue #790: respuesta cuando la cuenta que intenta vincular a un representado
# todavía no probó que la dirección de correo con la que se inscribió es suya.
#
# A diferencia de los dos textos de arriba, este SÍ es específico a propósito:
# no habla de la persona buscada -- de la que no revela absolutamente nada --
# sino del estado de la PROPIA cuenta de quien pregunta, que ya conoce. Un
# mensaje genérico acá sería una trampa: el representante real quedaría
# mirando un rechazo idéntico al de una cédula equivocada, sin manera de
# descubrir que lo único que le falta es abrir un correo.
MENSAJE_CORREO_SIN_VERIFICAR = (
    "Para vincular a un representado primero debe verificar su correo. "
    "Revise su bandeja de entrada o solicite un nuevo enlace de verificación."
)

# Issue #790, misma disciplina anti-enumeración que la recuperación de
# contraseña: el reenvío del enlace de verificación responde EXACTAMENTE esto
# exista o no la cuenta, y esté o no ya verificada. Si difiriera en algún
# caso, el formulario de reenvío sería un buscador de direcciones registradas.
MENSAJE_VERIFICACION_ENVIADA = (
    "Si el correo está registrado y falta verificarlo, se envió un enlace de "
    "verificación"
)
