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
