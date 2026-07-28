# Cata Club — Concepto, alcance y modelo de dominio

- **Fecha de firma:** 28 de julio de 2026
- **Estado:** vigente — este documento es la referencia contra la cual se compara todo trabajo del MVP
- **Origen:** sesión de definición conceptual (lápiz y papel) posterior al levantamiento de requisitos y a la auditoría de preparación para producción

## Propósito

Este documento fija tres cosas: qué es el sistema (concepto), qué hace y qué no hace (alcance), y cómo se nombran y relacionan sus piezas (modelo). Cualquier trabajo que no encaje en estas definiciones requiere una decisión explícita antes de ejecutarse.

---

## 1. Concepto

> Sistema de gestión de un club de taekwondo competitivo con proyección de crecimiento: padrón de miembros, membresías con pagos y descuentos administrados por el club, asistencia a entrenamientos, niveles de alumnos y fichas médicas — operado por el administrador y los entrenadores; representantes y alumnos consultan y se inscriben.

El club participa en competencias de nivel panamericano y espera crecer. El diseño responde a ese crecimiento con paginación, decisiones del negocio representadas como datos y un modelo cuyos nombres reflejan el negocio — no con funcionalidades especulativas.

---

## 2. Alcance del MVP

### Funcionalidades principales (donde se invierte)

1. **Membresías y pagos**, incluyendo el catálogo de descuentos administrado por el club. Es la razón de ser del sistema: saber quién está al día, quién debe y cuánto ingresa por mes.
2. **Asistencia**: pasar lista rápido y saber quién vino.

Ambas se apoyan en una base que debe ser sólida: **personas, perfil y autenticación**. La base no es una funcionalidad; es el piso de las otras dos.

### Funcionalidad existente congelada

Niveles, fichas médicas, notificaciones, reportes y chatbot ya existen y se mantienen operativos, pero **no reciben nueva inversión** hasta que las dos funcionalidades principales estén completas, correctas y rápidas.

### Lo que este sistema NO hace

| # | Fuera de alcance | Nota |
|---|---|---|
| 1 | Sueldos y nómina | Los entrenadores cobran un monto mensual fijo, gestionado fuera del sistema |
| 2 | Pagos en línea | El sistema registra pagos que ocurren fuera (efectivo, transferencia); el administrador los aprueba |
| 3 | Elegibilidad automática de descuentos | El catálogo es del club; la decisión de aplicar es del administrador |
| 4 | Asignación de entrenadores a clases | La clase la da el entrenador disponible; no existe la operación en el negocio |
| 5 | Torneos y competencias | Inscripciones, resultados y delegaciones quedan fuera; de solicitarse, es un módulo cotizado aparte |
| 6 | Contabilidad formal | No reemplaza al contador ni emite facturas fiscales |
| 7 | Inventario | Uniformes, equipos e implementos quedan fuera |
| 8 | Multi-club / multi-sede | Un club, una sede; una expansión futura requiere rediseño acordado |

Cada solicitud que caiga en esta tabla se responde con este documento y se cotiza como trabajo adicional.

---

## 3. Modelo de dominio

| Grupo | Entidad | Qué es | Estado respecto al código actual |
|---|---|---|---|
| Personas y acceso | Persona | Todo ser humano que el club conoce | Sin cambios |
| | Usuario | La cuenta de acceso de una Persona | Sin cambios |
| | Rol | Qué puede hacer: admin, entrenador, representante, alumno | Sin cambios |
| | AntecedentesClub | Historia previa del miembro | Sin cambios |
| Plata | TipoMembresia | El plan con su precio propio: mensual, trimestral, anual | El precio por duración vive aquí, no como descuento |
| | Membresia | El vínculo vigente de una persona con un plan | Sin cambios |
| | Pago | El hecho histórico: quién pagó cuánto; incluye pagos de $0 de becados | Sin cambios |
| | ComprobantePago | El documento que prueba el pago | Sin cambios |
| | **Descuento** | Catálogo autogestionado por el admin: nombre, porcentaje o monto, activo | **Entidad nueva** |
| | **DescuentoAplicado** | Registro por pago: qué descuento, valor congelado, a quién, quién autorizó | **Entidad nueva** |
| Entrenamiento | Categoria | Franja de edad con su horario, definida por el club | Pasa de enum a **tabla** |
| | HorarioEntrenamiento | Días y horario de una categoría | Queda; **pierde la relación con entrenador**; posible fusión futura con Categoria |
| | AlumnoHorario | Qué alumno entrena en qué horario | Sin cambios |
| | Asistencia | Quién vino qué día | Sin cambios |
| | Nivel | Los 11 escalones técnicos del club | Rename desde `NivelRanking` |
| | NivelAlumno | El nivel que tiene un alumno | Rename desde `Ranking` |
| Salud | FichaMedica | Lo que el entrenador debe saber antes del entrenamiento | Sin cambios |
| | Enfermedades | Detalle de condiciones médicas | Sin cambios |
| Comunicación | Notificacion | Avisos de membresía, pago e inscripción | Sale del módulo ranking a módulo propio |
| Geografía | Pais, Provincia, Canton, Direccion, Institucion | Origen y dirección de cada persona; Institucion habilita la beca municipal | Confirmadas por el alcance competitivo |

---

## 4. Decisiones de modelado

### Descuentos

- **Dos entidades:** `Descuento` (catálogo vivo, administrado por el club) y `DescuentoAplicado` (hecho histórico por pago).
- **Valor congelado:** al aplicar un descuento se guarda el valor vigente en ese momento. Cambios posteriores al catálogo no alteran pagos ya realizados.
- **Tope:** el descuento total de un pago nunca supera el 100 %; no existen pagos negativos.
- **Sin motor de reglas:** el sistema no calcula elegibilidad. El administrador elige qué descuentos aplicar y a quién; el sistema registra y suma.
- **Los casos reales son exenciones:** la beca municipal es 100 % y el descuento familiar significa que una persona de la familia no paga (100 % sobre esa persona, elegida por el club).
- **El becado no es un estado especial:** registra su pago normal en $0 con el descuento aplicado. Así figura al día con la misma lógica que todos y el club conoce cuánto subsidia por período.
- **El precio por duración no es un descuento:** cada `TipoMembresia` tiene su propio precio.

### Entrenadores y horarios

- **No existe entrenador fijo por horario:** la clase la da el entrenador disponible. Se elimina la relación en el modelo y desaparece la pantalla de asignación.
- **Permisos simplificados:** cualquier entrenador puede operar cualquier horario, incluida la toma de asistencia.
- **No se registra quién dictó cada clase:** los entrenadores cobran mensual fijo; el dato no tiene consumidor. Regla general aplicada: no se modela lo que nadie consume, y lo derivable de un hecho ya registrado no gana columna propia.

### Nombres y rigidez

- `Ranking` pasa a `NivelAlumno` y `NivelRanking` a `Nivel`: los nombres deben decir la verdad del negocio.
- `Categoria` pasa de enum a tabla: el club crea o modifica horarios sin desplegar código. Las decisiones del negocio son datos, no código.

---

## 5. Orden de trabajo del MVP

| Orden | Trabajo | Justificación |
|---|---|---|
| 1 | Los 4 hallazgos críticos de sesiones y autenticación (revocación por cambio de contraseña, suspensión y baja) | Es la base pedida — "buen manejo de auths" — y lo que bloquea producción |
| 2 | Paginación de los listados que crecen con el padrón | Requisito de crecimiento; observación docente verificada |
| 3 | Modelo de descuentos (`Descuento` + `DescuentoAplicado`) | Completa la funcionalidad principal de membresías y pagos |
| 4 | Eliminar la relación entrenador–horario y simplificar permisos de entrenador | Endereza la funcionalidad principal de asistencia |
| 5 | Renames (`Nivel`, `NivelAlumno`), `Categoria` a tabla, notificaciones a módulo propio | Comprometidos, pero tocan funcionalidad congelada: al final de la cola |

## 6. Pendientes anotados, no decididos

- Posible fusión de `HorarioEntrenamiento` dentro de `Categoria` cuando esta pase a tabla (categoría = franja de edad + días + horario).
- Vía de vinculación para que un representante quede asociado a una cuenta de menor creada de forma autogestionada (pendiente desde los hallazgos post-presentación).
