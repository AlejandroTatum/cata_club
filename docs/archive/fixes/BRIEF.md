# Brief común — agentes de corrección de Cata Club

Se aplica a **todos** los fixes de la tanda posterior a la auditoría del 10 de
agosto de 2026. Leelo entero antes de tocar una línea.

## Los dos documentos que mandan

- `docs/auditoria-qa/README.md` — el hallazgo: qué está mal, cómo reproducirlo,
  qué debería pasar, y el `archivo:línea`. **Es la especificación.**
- `docs/decisiones-de-negocio-2026-08-11.md` — cómo lo decidió el dueño.
  **No se re-discute.** Si algo no cierra al implementar, se para y se pregunta;
  no se resuelve por criterio propio a mitad de camino.

## TDD, sin excepciones

1. Escribí el test **primero**. Corrélo y **verificá que se pone rojo** por la
   razón correcta — no porque falta un import.
2. Implementá lo mínimo que lo pone verde.
3. Corré la suite del área que tocaste.

Un hallazgo se cierra cuando el test se pone rojo sin el fix. No cuando la
pantalla se ve bien.

- Backend: `cd backend && pytest "<archivo>::<test>"` (necesita
  `TEST_DATABASE_URL`, ver `backend/tests/conftest.py`).
- Frontend: `cd frontend && npx vitest run <archivo>`.

## El entorno de QA — y la trampa que ya nos costó una auditoría

Está levantado: frontend `:3000`, backend `:8000`, admin
`admin@cataclub.com` / `admin12345`, entrenador `entrenador@cataclub.com` /
`trainer12345`, representante con 4 hijos `sebastiansabando21@cataclub.com` /
`alumno123` (todas las cuentas del seed grande usan `alumno123`).

**El sandbox bloquea localhost y Docker.** Todo comando que los toque necesita
`dangerouslyDisableSandbox: true`. Si un `curl` da exit 7 o status 000, es eso.

**LA TRAMPA:** el contenedor corre una **imagen**, no tu working tree. Si
cambiás código y sacás una captura sin reconstruir, estás fotografiando el
código viejo. Ya nos pasó: una auditoría entera se hizo contra un frontend de
tres días atrás.

Para ver tu propio cambio, elegí una:

- **Frontend (recomendado, rápido):** `cd frontend && pnpm dev` en segundo
  plano, que levanta en `:3001` o el puerto que informe, apuntando al backend de
  QA. Sacás la captura de ahí.
- **Backend:** reconstruí solo ese servicio:
  `docker compose -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.qa.yml up -d --build --wait backend`

**Nunca** corras `make qa-up`, `qa-down` ni `qa-reset` sin avisar: se pierde el
dataset y hay trabajo apoyado en él.

## Capturas — el dueño revisa por captura

El MCP de Playwright no funciona acá (le falta Chrome de sistema). Manejá el
navegador con un script propio, importando Chromium por ruta absoluta:

```js
const { chromium } = await import(
  "/home/alejo/devwork/.projects/apps/cata_club/frontend/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs"
);
```

Corré el script **desde `frontend/`**. Guardá las capturas en
`docs/fixes/img/` con nombre `NN-<tema>-<antes|despues>.png`.

**Mirá cada captura antes de usarla.** Una pantalla en blanco es un fallo de tu
driver, no evidencia.

## Git — reglas del proyecto, no negociables

1. **Nunca commitear a `main`.** Rama desde `main` fresco,
   `type/descripcion-corta`.
2. **Commits convencionales**, en inglés, imperativo, asunto ≤72 caracteres.
   **Sin trailers de atribución a IA.**
3. Un cambio lógico por commit.
4. **No abras el PR ni pushees** salvo que se te pida explícitamente. Dejá la
   rama commiteada y avisá.
5. Los documentos y el código van en inglés salvo la copia de interfaz y los
   docs de `docs/`, que son en castellano.

## El documento de tu fix

Uno por fix, en `docs/fixes/NN-<slug>.md`. Esta estructura, sin agregarle
secciones:

```markdown
# Fix NN · <título en castellano llano>

- **Cierra:** <ids de hallazgo>
- **Decisión que lo gobierna:** <la del documento de decisiones, en una línea>
- **Rama:** <nombre>
- **Commits:** <sha corto — asunto>

## El problema

<2-4 líneas, en castellano llano, sin jerga. Qué le pasaba al usuario.>

![antes](img/NN-tema-antes.png)

## Qué se hizo

<Qué cambió y por qué así. Si descartaste otro camino, decilo en una línea.>

## El candado

<El test que se pone rojo sin el fix. Nombre y archivo.>

​```
<la salida real del test: rojo antes, verde después>
​```

## La prueba

![después](img/NN-tema-despues.png)

<Una línea: qué se ve en la captura que antes no se veía.>

## Lo que NO cambió

<Lo que quedó igual a propósito, para que nadie lo lea como olvido.>
```

## Qué devolvés

En tu mensaje final: qué cerraste, el nombre de la rama, los tests que corriste
con su resultado, y la ruta del documento. Si algo te bloqueó, decilo — un fix a
medias reportado como completo es peor que uno no hecho.
