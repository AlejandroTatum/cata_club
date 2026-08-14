# Fix 02 · Sesión y acceso

- **Cierra:** TRA-10, TRA-4, DSH-6
- **Decisión que lo gobierna:** retraso creciente por cuenta en el login (1s al 3er intento fallido, duplicando, techo de 60s), nunca bloqueo duro — trabar la cuenta regala un ataque nuevo (decisiones-de-negocio-2026-08-11.md §3)
- **Rama:** fix/sesion-y-acceso
- **Commits:**
  - `3372dcd` — fix(auth): revoke session tokens on logout
  - `8718c49` — fix(auth): add progressive per-account login delay
  - `de40240` — fix(auth): don't log out the admin on a network blip at load

## El problema

Cerrar sesión no cerraba nada del lado del servidor: el `access_token` seguía sirviendo hasta que expiraba solo, y el `refresh_token` hasta 7 días — alguien que hubiera copiado esa llave antes seguía adentro (TRA-10). Nada frenaba a quien probara contraseñas contra la cuenta de un socio puntual, más allá de un tope genérico por IP fácil de esquivar (TRA-4). Y si al administrador se le cortaba un instante la conexión justo al abrir el panel, el sistema lo mandaba a la pantalla de login sin decirle nada — iba a pensar que se le venció la sesión (DSH-6).

**Nota sobre las imágenes de este documento:** los tres hallazgos se verificaron desde un worktree aislado, sin acceso al stack Docker/QA compartido (ver `docs/fixes/BRIEF.md`, sección "El entorno de QA"). TRA-10 y TRA-4 son endpoints puros de backend, sin pantalla propia que capturar; para DSH-6 sí hay una pantalla involucrada (`/dashboard`), pero levantar `pnpm dev` o reconstruir el backend de QA no era alcanzable desde este entorno. No se incluye ningún `![antes]/[después]`: la evidencia real está en las corridas de test pegadas más abajo. Un maintainer con acceso al stack de QA debería capturar el par antes/después de DSH-6 (repro exacto: login admin, `page.route('**/api/**', route => route.abort('failed'))`, navegar a `/dashboard`) antes de mergear, si se lo quiere además del test.

## Qué se hizo

**TRA-10.** `/auth/logout` no tenía ninguna dependencia de autenticación (no sabía a quién cerrarle la sesión) y no tocaba la base. La pieza que sí funciona ya existía: `/auth/sesiones/invalidar` bombea `version_sesion` del usuario, lo que invalida de inmediato todo token previo (access y refresh, vía el claim `sver` que valida `GestorAutenticacion.epoch_valido` en cada decode). Pero reusar ese endpoint *tal cual* para logout era el camino equivocado: su método (`invalidar_otras_sesiones`) reemite un par de tokens nuevo en la misma respuesta a propósito, para que el caller siga logueado — exactamente lo contrario de lo que un logout necesita. Extraje el bombeo del epoch a una primitiva privada compartida (`_bombear_epoch_sesion`) y agregué `cerrar_sesion` encima, que la usa SIN reemitir tokens. `invalidar_otras_sesiones` quedó reescrito sobre la misma primitiva, agregando el re-issue que le es propio. El router ahora exige `Depends(GestorAutenticacion.decodificar_token)` en `/auth/logout`, igual que ya lo exige `/auth/sesiones/invalidar`.

Descartado: reusar `invalidar_otras_sesiones` completo desde el router de logout. Aunque el `response_model` (`LogoutResponseDTO`, solo expone `mensaje`) habría filtrado los tokens de la respuesta y el resultado observable desde afuera hubiera sido casi el mismo, seguía siendo trabajo de firma JWT tirado a la basura en cada logout y, peor, dejaba el código diciendo una cosa (el docstring de `invalidar_otras_sesiones` promete "el caller sigue autenticado") mientras hacía otra en este call site — la clase de confusión que reintroduce bugs en el próximo refactor.

**TRA-4.** El único freno era el rate limiter genérico de `/auth/login` (60/minuto, de hecho por IP en este endpoint pre-auth), que no distingue cuentas: reparte el ataque entre IPs o simplemente entra en el cupo. Agregué un contador de intentos fallidos CONSECUTIVOS por cuenta (`_INTENTOS_FALLIDOS_LOGIN`, un dict a nivel de módulo — simplificación aceptada, mismo criterio que la ausencia de blacklist Redis ya documentada en `refrescar_sesion`): no sobrevive un reinicio del proceso ni se comparte entre réplicas. Antes del 3er intento fallido no hay retraso; desde el 3ro, `AuthServicio._penalizar_intento_fallido` llama a un `dormir` inyectable con 1s, 2s, 4s… duplicando, con techo de 60s (exactamente la curva de la decisión de negocio). Un login exitoso resetea el contador de esa cuenta a cero.

La parte que exigía más cuidado era anti-enumeración: el contador y el retraso tenían que aplicarse igual sin importar si la cuenta existe. La solución fue clavar la clave del contador (`correo.strip().lower()`) y aplicar la penalización SOBRE EL MISMO catch de `CredencialesInvalidas`, sin importar cuál de las tres ramas de `_verificar_credenciales` la disparó — cuenta inexistente, contraseña incorrecta, cuenta inactiva o persona dada de baja. Las cuatro son indistinguibles por mensaje (ya lo eran) y ahora también por timing: el test `test_cuenta_inexistente_sigue_la_misma_curva_de_retraso_que_una_real` corre la misma secuencia de intentos contra una cuenta real y una inexistente y compara la lista exacta de retrasos invocados — dan igual.

**DSH-6.** `authService.getSession()` ya devuelve un resultado de tres vías (`authenticated` / `unauthenticated` / `outage`), y el `revalidate` periódico ya trataba `outage` como no-operación. El bug estaba en el efecto de hidratación del montaje inicial (`AuthContext.tsx`, antes línea 109): colapsaba `unauthenticated` y `outage` en el mismo `session = null`, así que una caída de red en la primerísima carga se veía igual que "nunca inició sesión" y `ProtectedRoute` mandaba al admin a `/login` sin ningún aviso. Agregué un estado nuevo, `hydrationOutage`, que solo la hidratación inicial toca (nunca el `revalidate` periódico, que ya tiene sesión en pantalla y no necesita decir nada). `ProtectedRoute` ahora, cuando `hydrationOutage` está activo, no redirige — muestra el componente `ErrorState` ya existente en el sistema de diseño ("No se pudo verificar tu sesión", con botón "Reintentar" que llama a la nueva acción `retryHydration`). Un resultado `unauthenticated` genuino sigue deslogueando y redirigiendo exactamente igual que antes.

## El candado

**TRA-10** — `test_logout_invalida_access_token_y_refresh_token`, `backend/tests/test_auth_registro_refresh.py`:

```
# Antes del fix (RED)
______________ test_logout_invalida_access_token_y_refresh_token _______________
    me_resp = client_sin_token.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {access}"}
    )
>   assert me_resp.status_code == 401
E   assert 200 == 401
E    +  where 200 = <Response [200 OK]>.status_code
tests/test_auth_registro_refresh.py:251: AssertionError

# Después del fix (GREEN)
tests/test_auth_registro_refresh.py::test_logout_invalida_access_token_y_refresh_token PASSED [100%]
========================= 1 passed, 1 warning in 0.81s =========================
```

**TRA-4** — `test_tercer_intento_fallido_retrasa_un_segundo` y `test_cuenta_inexistente_sigue_la_misma_curva_de_retraso_que_una_real`, `backend/tests/test_auth_freno_login.py`:

```
# Antes del fix (RED) -- el módulo ni siquiera exponía el contador todavía
@pytest.fixture(autouse=True)
def _limpiar_contador_intentos():
>   auth_servicio_modulo._INTENTOS_FALLIDOS_LOGIN.clear()
    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
E   AttributeError: module 'app.servicios_negocio.auth_servicio' has no attribute '_INTENTOS_FALLIDOS_LOGIN'

# Después del fix (GREEN)
tests/test_auth_freno_login.py::test_tercer_intento_fallido_retrasa_un_segundo PASSED [ 50%]
tests/test_auth_freno_login.py::test_cuenta_inexistente_sigue_la_misma_curva_de_retraso_que_una_real PASSED [100%]
========================= 2 passed, 1 warning in 2.39s =========================
```

**DSH-6** — `AuthProvider initial hydration > does not log the user out when the initial check hits an outage`, `frontend/src/contexts/__tests__/AuthContextHydration.test.tsx`:

```
# Antes del fix (RED)
 × AuthProvider initial hydration > does not log the user out when the initial check hits an outage 36ms
   → expect(element).toHaveTextContent()
   Expected element to have text content:
     true
   Received:
     undefined
    99|     // "unauthenticated" just because the network hiccupped.
   100|     expect(screen.getByTestId("authenticated")).toHaveTextContent("fal…
   101|     expect(screen.getByTestId("outage")).toHaveTextContent("true");
      |                                          ^
 Test Files  1 failed (1)
      Tests  3 failed (3)

# Después del fix (GREEN)
 ✓ src/contexts/__tests__/AuthContextHydration.test.tsx (3 tests) 33ms
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

## La prueba

Sin captura (ver nota en "El problema"). La evidencia es la corrida completa de cada suite nueva, después del fix:

```
$ cd backend && pytest tests/test_auth_registro_refresh.py tests/test_auth_tipo_token.py tests/test_guardia_autorizacion_rutas.py tests/test_auth_freno_login.py -q
............................
20 passed, 1 warning in ...s   # test_auth_registro_refresh.py + test_auth_tipo_token.py
2 passed                       # test_guardia_autorizacion_rutas.py
6 passed, 1 warning in 7.11s   # test_auth_freno_login.py

$ cd backend && pytest tests/ -q
872 passed, 2 skipped, 12 warnings in 83.94s   # suite completa del backend, sin regresiones

$ cd frontend && npx vitest run
Test Files  162 passed (162)
     Tests  2448 passed (2448)   # suite completa del frontend, sin regresiones
```

Sobre TRA-4 en particular: no hay curl transcript contra un servidor real corriendo (no había uno disponible desde este worktree) — la evidencia es la corrida de pytest de arriba contra el TestClient de FastAPI en proceso, con aserciones explícitas sobre los valores exactos con que se invocó el `dormir` inyectado (`[1]`, luego `[1, 2, 4, 8, 16, 32, 60, 60]` para 10 intentos consecutivos), nunca un sleep real.

## Lo que NO cambió

El rate limiter genérico de `/auth/login` (60/minuto) sigue ahí sin tocar — el freno por cuenta de TRA-4 es un mecanismo nuevo y aparte, no un reemplazo. `/auth/sesiones/invalidar` sigue reemitiendo un par de tokens nuevo exactamente como antes ("cerrar mis otras sesiones" sigue dejando al caller adentro); solo el logout cambió de comportamiento. El contador de intentos fallidos de TRA-4 es en memoria del proceso, a propósito (documentado en el código): no sobrevive un restart ni se comparte entre réplicas — moverlo a Redis con TTL queda para cuando haga falta escalar a más de una instancia. El `revalidate` periódico de `AuthContext` (chequeo de sesión cada 5 minutos mientras la pestaña sigue abierta) no se tocó: ya trataba `outage` correctamente, el bug estaba solo en la hidratación del montaje inicial. Y los dos archivos de pagos (`frontend/src/app/student/payments/page.tsx`, `frontend/src/app/payments/page.tsx`) no se abrieron ni se tocaron — otro agente los tiene en curso en la copia de trabajo real.
