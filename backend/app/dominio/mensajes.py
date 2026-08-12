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
# El frontend detecta este texto para ofrecer "Iniciar sesión" / "Recuperar
# contraseña" (`frontend/src/lib/duplicate-identity.ts`); cambiarlo aquí sin
# actualizar ese archivo rompe esa salida, y por eso hay un test que lo fija
# (`tests/test_mensajes_identidad_duplicada.py`).
MENSAJE_IDENTIDAD_DUPLICADA = "Ya existe una cuenta registrada con los datos ingresados."

# INS-2 (docs/decisiones-de-negocio-2026-08-11.md §1, guardarraíl 3): respuesta
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
