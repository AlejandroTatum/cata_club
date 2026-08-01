# Escala tipográfica

`frontend/tailwind.config.ts` tokenizaba color, familia, espaciado, alturas, radios, sombras y
anchos. No tokenizaba `fontSize`: la tipografía era el único eje del sistema que nunca se nombró,
y el resultado medido eran **24 tamaños distintos** escritos a mano en 331 lugares, con racimos
como `12.5` + `13` + `13.5` separados por medio píxel.

Este documento describe la escala que reemplaza esos 24 tamaños. La migración de los usos
existentes es trabajo de los PR siguientes del issue #29; acá se define el destino.

## Los ocho escalones

Cada escalón se declara en la forma de tupla de Tailwind, `[tamaño, { lineHeight, letterSpacing }]`.
Elegir un escalón resuelve las tres decisiones de una vez.

| Escalón | Tamaño | Interlineado | Tracking | Para qué |
|---|---|---|---|---|
| `text-2xs` | 10,5px | 1,4 | +0,12em | Microetiqueta en mayúsculas: cabecera de tabla, kicker, texto de badge |
| `text-xs` | 12,5px | 1,5 | 0 | Metadato secundario: texto de ayuda, fechas, texto de chip |
| `text-sm` | 13,5px | 1,5 | −0,005em | Interfaz densa: celda de tabla, etiqueta de formulario, fila de lista |
| `text-base` | 15px | 1,45 | −0,01em | Cuerpo. El tamaño de lectura por defecto del producto |
| `text-lg` | 20px | 1,2 | −0,02em | Título de card, título de diálogo, nombre que encabeza una fila |
| `text-xl` | 26px | 1,15 | −0,03em | Título de página |
| `text-2xl` | 32px | 1,05 | −0,04em | Número de stat |
| `text-display` | 46px | 0,95 | −0,05em | Titular de héroe: panel de auth, landing, "próxima sesión" del entrenador |

### Por qué esos valores

**No se inventaron.** `xl` es exactamente el título de 26px que ya renderiza
`components/ui/PageHeader.tsx`, `2xl` es el número de 32px de `components/ui/StatCard.tsx` y
`display` es el titular de 46px del login. La escala se transcribió de los componentes ya
aprobados, así que migrar un `text-[26px]` existente a `text-xl` no mueve un píxel.

**La razón entre escalones crece de abajo hacia arriba:** 1,19 · 1,08 · 1,11 · 1,33 · 1,30 ·
1,23 · 1,44. La base es densa porque entre 10 y 15px conviven la etiqueta, el valor y el cuerpo,
y tienen que distinguirse de un vistazo; la cima es aireada porque un titular solo compite
consigo mismo.

**El tracking sigue al tamaño, como debe ser.** A 46px un tracking normal se lee como separación
entre letras; a 10,5px se lee como una mancha. De ahí −0,05em arriba y +0,12em abajo. Que el
escalón lo traiga puesto es justamente lo que evita que cada titular vuelva a tomar la decisión.

**El interlineado también.** 1,5 en texto de interfaz, 0,95 en un titular de 46px. Un titular con
interlineado de cuerpo se lee como dos líneas sueltas, no como un bloque.

## Qué absorbe cada escalón

Los 24 tamaños del inventario congelado, repartidos:

| Escalón | Absorbe |
|---|---|
| `2xs` | 9 · 9,5 · 10 · 10,5 · 11 · 11,5 |
| `xs` | 12 · 12,5 · 13 |
| `sm` | 13,5 · 14 · 14,5 |
| `base` | 15 · 17 |
| `lg` | 20 |
| `xl` | 24 · 26 · 27 |
| `2xl` | 30 · 32 |
| `display` | 40 · 42 · 46 · 56 |

Los racimos de medio píxel desaparecen por construcción: `12,5` + `13` (182 usos junto con `13,5`)
caen en `xs`, y `13,5` + `14` + `14,5` en `sm`. Nadie percibía la diferencia; el sistema deja de
ofrecerla.

## Los escalones nombrados de tracking e interlineado

Existen para los casos en que un valor tiene que **contradecir** el que trae su escalón de
tamaño — un texto en mayúsculas a tamaño de cuerpo, o un titular que no debe heredar el
apretado de su escalón. No son un segundo catálogo.

| Token | Valor | Cuándo |
|---|---|---|
| `tracking-dense` | −0,02em | Apretar a un tamaño cuyo escalón no aprieta lo suficiente |
| `tracking-flat` | 0 | Cancelar un tracking negativo heredado (datos tabulares, códigos, identificadores) |
| `tracking-caps` | 0,12em | Mayúsculas a tamaño chico. El default de `2xs`, reutilizable |
| `tracking-caps-wide` | 0,2em | Mayúsculas que deben leerse como una regla, no como una palabra |
| `leading-crisp` | 1,15 | Titular que envuelve y tiene que seguir siendo un bloque |
| `leading-body` | 1,45 | El default de `base`, aplicado a otro tamaño |
| `leading-prose` | 1,55 | Párrafo largo: ayuda, textos legales, prosa de estado vacío |

**Los nombres están deliberadamente fuera del vocabulario de Tailwind.** `tracking-tight` tiene 14
usos, `tracking-wider` 8, `leading-relaxed` 47, `leading-tight` 7 y `leading-none` 7: 83 usos que
el candado no vigila y que nadie está revisando en este issue. Redefinir una de esas claves movería
tipografía que nadie pidió mover. Por eso estos escalones **extienden**, no reemplazan.

## La colisión de `fontSize`, y cómo se resolvió

`fontSize` sí redefine las claves estándar: declarar `xs`…`2xl` en `extend` cambia el significado
de toda clase `text-*` que ya estaba escrita. El candado no puede verlo — son clases legítimas
cuyo valor cambia por debajo.

| Clase | Antes | Ahora | Usos | Decisión |
|---|---|---|---|---|
| `text-xs` | 12px | 12,5px | 122 | Se deja. +0,5px |
| `text-sm` | 14px | 13,5px | 106 | Se deja. −0,5px |
| `text-base` | 16px | 15px | 6 | Se deja. −1px |
| `text-lg` | 18px | 20px | 5 | **Reescritas como `text-[18px]`** |
| `text-xl` | 20px | 26px | 1 | **Reescrita como `text-lg`**, que mide 20px exactos |
| `text-2xl` | 24px | 32px | 7 | **Reescritas como `text-[24px]`** |

Los 234 usos que se dejaron entran al sistema gratis: la deriva máxima es de 1px y a cambio
heredan el interlineado y el tracking del escalón. Los 13 que se movían de forma visible se
reescribieron a mano en el mismo commit, para que la rama nunca aterrice en `main` con un cambio de
tamaño que nadie decidió.

Dos de esas reescrituras dejan deuda a propósito:

- **`text-[18px]`** es la única entrada que se agregó jamás a la lista blanca del candado. No hay
  escalón de 18px, y elegir entre 15 y 20 para cada uno de los cinco usos es una decisión de
  diseño, no mecánica. La toma el PR de migración, que después borra la entrada.
- **`text-[24px]`** ya estaba en el inventario congelado, así que no agrega nada. Mismo criterio:
  24px queda entre `lg` (20) y `xl` (26) y hay que decidir caso por caso.

Donde el interlineado venía del propio `text-*` y el cambio superaba 1px, la reescritura lo fija con
el escalón numérico de Tailwind que lo reproduce exacto (`leading-7` = 28px, `leading-8` = 32px).
Son andamios: el PR de migración los quita al elegir el escalón definitivo.

## Anclas que no se mueven

Son las dos reglas duras de "La Paleta" y sirven de control negativo de cualquier verificación
visual de este eje:

| Componente | Elemento | Valor |
|---|---|---|
| `components/ui/PageHeader.tsx` | título de página | 26px — cae exacto en `xl` |
| `components/ui/StatCard.tsx` | número de stat | 32px — cae exacto en `2xl` |

Ambas siguen escritas como `text-[26px]` y `text-[32px]` hasta que el PR de migración las
convierta. Que el escalón mida lo mismo es lo que hace que esa conversión sea gratuita.

## Cómo se usa

Un titular necesita cuatro decisiones tipográficas. Antes las cuatro estaban sueltas:

```tsx
<h1 className="text-[26px] font-extrabold leading-[1.15] tracking-[-0.03em] text-ink">
```

Con la escala son dos, y una la resuelve el escalón:

```tsx
<h1 className="text-xl font-extrabold text-ink">
```

El peso sigue suelto a propósito: reducir los cinco pesos activos a tres es otro PR del mismo
issue.
