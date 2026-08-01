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
| `xs` | 12 · 12,5 |
| `sm` | 13 · 13,5 · 14 |
| `base` | 14,5 · 15 · 17 |
| `lg` | 20 |
| `xl` | 24 · 26 · 27 |
| `2xl` | 30 · 32 |
| `display` | 40 · 42 · 46 · 56 |

Los racimos de medio píxel desaparecen por construcción: `13` + `13,5` + `14` caen en `sm`, y
`14,5` + `15` + `17` en `base`. Nadie percibía la diferencia; el sistema deja de ofrecerla.

**Dos casillas de esta tabla se corrigieron al migrar la banda de cuerpo.** La primera versión
mandaba `13` a `xs` y `14,5` a `sm`, y ninguna de las dos era la más cercana: `13` está a medio
píxel de `xs` y de `sm` por igual —el empate se resuelve hacia arriba, que es donde viven sus
otros 83 usos de interfaz densa—, y `14,5` está a medio píxel de `base` pero a un píxel entero
de `sm`. Reasignarlas es lo que hace que la migración sea un redondeo al escalón más próximo y
no una lista de excepciones.

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

Dos de esas reescrituras dejaron deuda a propósito, y la migración de la banda display ya la saldó:

- **`text-[18px]`** fue la única entrada que se agregó jamás a la lista blanca del candado. Sus
  cinco usos —el wordmark del header, la portada de la card de cuenta creada y el título del
  diálogo de miembro— son todos encabezados, así que subieron a `lg` (20px). Bajarlos a `base`
  los habría dejado del tamaño del cuerpo que encabezan. La entrada está borrada.
- **`text-[24px]`** cayó entero en `xl` (26px), que es el escalón que la tabla de absorción ya le
  asignaba y el que el candado sugiere: 24 está a 2px de `xl` y a 4px de `lg`.

Donde el interlineado venía del propio `text-*` y el cambio superaba 1px, la reescritura lo fijó con
el escalón numérico de Tailwind que lo reproduce exacto (`leading-7` = 28px, `leading-8` = 32px).
Eran andamios y ya no están: al elegir el escalón definitivo, el interlineado vuelve a viajar con
el tamaño, que es el punto de la escala.

## Lo que costó la banda de cuerpo

145 líneas, seis tamaños retirados de la lista blanca. Tres decisiones no fueron mecánicas:

- **17px → `base` (15px), −2px, ocho usos.** Son subtítulos de sección (`trainer`, `payments`,
  `student/payments`, `student` ×3, `PaymentBand`, `student/attendance`). Subirlos a `lg` (20px)
  los habría puesto a la altura de un título de card; el escalón más cercano es `base`, y a esa
  distancia el subtítulo sigue separándose del cuerpo por peso, que es como venía separándose.
- **`sm:text-[17px]` desapareció entero.** En `payments/page.tsx` el nombre del solicitante subía
  de 15 a 17px a partir de `sm`. Los dos extremos caen en `base`, así que el escalón responsivo se
  quedó sin diferencia que expresar y la clase se retiró en lugar de duplicarse.
- **Los overrides que ya no se ganaban el lugar.** Los cuatro `tracking-[-0.015em]` estaban a
  0,005em del tracking que `base` trae puesto y se borraron; el `-0.02em` de la cuota vencida sí
  contradice a su escalón y pasó a `tracking-dense`. Igual el interlineado: `leading-[1.45]` del
  chat cedió al 1,5 de `sm`, `leading-[1.25]` de la stat de `student` pasó a `leading-tight`
  —mismo valor, escalón de fábrica— y el `leading-[1.35]` del toast cedió al 1,5 de `sm`, que le
  agranda la caja de línea 2,03px por renglón. Es el único cambio de altura de la banda.

## Anclas que no se mueven

Son las dos reglas duras de "La Paleta" y sirven de control negativo de cualquier verificación
visual de este eje:

| Componente | Elemento | Valor |
|---|---|---|
| `components/ui/PageHeader.tsx` | título de página | 26px — cae exacto en `xl` |
| `components/ui/StatCard.tsx` | número de stat | 32px — cae exacto en `2xl` |

Ya están escritas como `text-xl` y `text-2xl`. El tamaño y el tracking renderizados no se movieron
—`text-xl` es 26px/−0,03em y `text-2xl` es 32px/−0,04em, exactamente lo que decían las clases
arbitrarias—. `StatCard` además lleva `leading-none`, así que su caja de línea tampoco cambió;
el título de `PageHeader` no declaraba interlineado y por lo tanto heredaba el 1,5 del `html`, y
ahora toma el 1,15 de su escalón: la caja pasa de 39px a 29,9px. Es el cambio que la escala
existe para hacer —un titular de página con interlineado de cuerpo es el defecto, no la
referencia— y es el único que estas dos anclas registran.

El ancla cubre el título, no la tarjeta entera: el subtítulo de `PageHeader` era `text-[13px]` y
la banda de cuerpo lo llevó a `sm`, o sea 13,5px. Medio píxel, en toda página de administración.

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
