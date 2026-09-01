"""Constantes de reglas de negocio que más de una capa necesita leer.

Un valor vive acá, en vez de en `servicios_negocio` o en `presentacion`,
precisamente cuando AMBAS capas lo necesitan: `dominio` no depende de
ninguna de las dos, así que importar desde acá nunca arma un ciclo. Ver el
caso que originó este archivo justo abajo.
"""
from datetime import time

# Issue #262, recreado desde cero para la corrección explícita del issue
# #389 (slice 2): el mecanismo previo (rol + este mismo tope) fue eliminado
# del camino de `registrar_asistencia` en el slice 1. Mismo valor: el
# criterio de negocio no cambió, solo el CAMINO por el que se corrige.
#
# Issue #663: además de `AsistenciaServicio.corregir_asistencia` (que
# rechaza la corrección pasada la ventana), `AsistenciaResponseDTO` también
# lee este número para computar `correctable` -- el frontend lo necesita
# para decidir si mostrar el botón "Corregir" o el motivo de por qué no,
# ANTES de que el admin intente corregir y reciba un 400. Si el número
# viviera solo en `servicios_negocio.asistencia_servicio`, la respuesta
# hubiera sido mirrorearlo en TypeScript -- exactamente la clase de
# duplicación entre dos lenguajes que ya se repitió sin querer en
# `frontend/src/app/trainer/attendance/attendance-utils.ts`
# (`CORRECTION_WINDOW_DIAS`) y en
# `frontend/src/app/trainer/attendance/history/page.tsx`
# (`LIMITE_CORRECCION_DIAS`). Un solo entero, importado por ambas capas
# backend, es la fuente de verdad; el DTO lo expone y el frontend solo lee
# el campo.
LIMITE_CORRECCION_ASISTENCIA_DIAS = 30

# Issue #861: la franja de una categoría solo estaba obligada a no venir
# invertida (inicio anterior al fin), así que un entrenamiento de 02:00 a
# 04:00 se guardaba sin protestar y salía publicado en la grilla del club.
# La ventana es la del predio: abre 06:00, cierra 22:00.
#
# Los bordes son INCLUSIVOS -- una categoría que arranca 06:00 en punto o
# termina 22:00 en punto entrena adentro del horario, no afuera.
#
# Viven acá y no en `asistencia_servicio` porque el formulario del admin
# tiene que poder marcar el mismo límite ANTES de enviar (mismo motivo por
# el que `LIMITE_CORRECCION_ASISTENCIA_DIAS` subió de capa en el issue
# #663). Que el frontend acote el campo no releva al backend de exigirlo:
# un llamado directo a la API no pasa por ningún formulario, así que la
# regla se sigue verificando acá aunque la pantalla ya la muestre.
HORA_MINIMA_ENTRENAMIENTO = time(6, 0)
HORA_MAXIMA_ENTRENAMIENTO = time(22, 0)

# Mismo issue: nada impedía marcar los siete días. Una categoría que entrena
# toda la semana no le deja al club ni un día de descanso, y en la práctica
# es un error de tipeo en el formulario, no una decisión.
#
# El tope es SEIS y no cinco por Competitivo, la categoría insignia del
# club, que entrena de lunes a sábado: un `< 6` la dejaría sin poder
# guardarse.
MAXIMO_DIAS_POR_CATEGORIA = 6
