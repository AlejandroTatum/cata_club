"""
Regla de contraseña compartida por cada camino que acuña o restablece una
credencial (issue #1017, ADR-5).

El defecto nunca fue el piso de largo -- ya estaba en 8 en cada DTO del
backend. El defecto era que el backend se quedaba ahí: sin ninguna lista
negra, mientras el frontend (`frontend/src/lib/identity-validation.ts:476,
500`, `COMMON_PASSWORDS` + `passwordRule`) ya rechazaba las mismas ~150
contraseñas comunes antes de que el formulario saliera del navegador --
`POST /enrollment/` aceptaba `"12345678"` mientras el wizard ya la refusaba,
la misma clase de defecto que abrió `dominio/cedula.py` (issue #228): una
regla que solo vive en el navegador no es una regla.

Decisión del dueño, 2026-09-03: el piso NO se mueve. Subirlo (la ex "fix 3b",
a 12) se descartó por completo, no se difirió. El issue #230 (CERRADO) ya
había resuelto la forma de esta política como largo + lista negra, no
requisitos de composición; subir el piso habría reabierto esa decisión.

`CONTRASENIAS_COMUNES` es una copia deliberada, no una importación, de
`COMMON_PASSWORDS` en `identity-validation.ts` -- el dominio de Python no
puede importar un módulo de TypeScript. Mismo contenido, agrupado igual, y
misma comparación insensible a mayúsculas y espacios al borde. Si la lista
del frontend cambia, esta copia tiene que cambiar con ella.

Vive en `dominio/`, no en `dtos/validadores.py`, por el mismo motivo que
`cedula.py` y `telefono.py`: ese módulo *compone* alias `Annotated`, las
reglas en sí viven acá. Puro, sin imports cruzados de capa.
"""

LONGITUD_MINIMA_CONTRASENIA = 8

# bcrypt (backend/app/seguridad/gestor_auth.py:21) solo considera los primeros
# 72 BYTES de la contraseña: todo lo que exceda ese límite se ignora en
# silencio al hashear, así que dos contraseñas distintas que compartan ese
# prefijo abren la misma cuenta (issue #1043). El límite es del algoritmo, no
# una regla de composición -- no reabre #230.
#
# Se mide en bytes UTF-8 (`len(valor.encode("utf-8"))`), nunca en caracteres
# (`len(valor)`): bcrypt cuenta bytes y la persona cuenta caracteres. Con
# tildes (2 bytes) o emoji (4 bytes) el corte real llega mucho antes que el
# largo visible en pantalla -- 30 emoji son 120 bytes, pero bcrypt solo ve los
# primeros 18 (72 bytes). Es un tope de ESCRITURA, no de verificación: una
# contraseña larga ya hasheada antes de este cambio sigue permitiendo iniciar
# sesión, porque el login no pasa por `validar_contrasenia` (compara contra
# el hash existente, no acuña uno nuevo).
LONGITUD_MAXIMA_CONTRASENIA_BYTES = 72

_SECUENCIAS_DE_DIGITOS = (
    "12345678", "123456789", "1234567890", "87654321", "11111111", "00000000",
    "22222222", "33333333", "44444444", "55555555", "66666666", "77777777",
    "88888888", "99999999", "123123123", "12341234", "01234567", "98765432",
    "11223344", "10203040", "192837465", "13131313", "12121212", "11112222",
    "1111", "0000", "121212", "112233", "555555", "666666", "777777", "888888",
    "999999", "102030", "1q2w3e4r", "1qaz2wsx", "1qazxsw2", "q1w2e3r4",
    "zaq12wsx", "1234qwer",
)

_CAMINATAS_DE_TECLADO = (
    "qwerty", "qwertyui", "qwertyuiop", "qwerty123", "asdfghjk", "asdfasdf",
    "asdfghjkl", "zxcvbnm", "zxcvbnm1", "zxcvbn", "qazwsxedc", "poiuytrewq",
    "mnbvcxz",
)

_PALABRAS_Y_PERSONAJES = (
    "password", "password1", "password123", "passw0rd", "letmein", "letmein1",
    "welcome", "welcome1", "welcome123", "monkey", "monkey1", "dragon",
    "dragon1", "football", "football1", "baseball", "baseball1", "master",
    "master1", "shadow", "superman", "batman", "spiderman", "starwars",
    "whatever", "computer", "internet", "freedom", "matrix", "ninja123",
    "hunter1", "hunter2", "soccer", "hockey123", "killer123", "trustno1",
)

_AFECTO_ESTACIONES_Y_COLORES = (
    "iloveyou", "iloveyou1", "sunshine", "sunshine1", "princess", "princess1",
    "cheese123", "summer2024", "summer123", "winter123", "spring123",
    "flower123", "purple123", "diamond1", "silver123", "golden123",
    "family123", "friends1", "forever1", "always123", "mylove123",
    "sweetheart", "chocolate",
)

_VALORES_POR_DEFECTO_DE_CUENTA = (
    "abcd1234", "a1b2c3d4", "abc12345", "test1234", "testing123",
    "changeme", "changeme1", "default1", "admin123", "administrator",
    "adminadmin", "rootroot", "toor1234", "guest123", "temp1234", "temppass",
    "newpass1", "mypassword", "thepassword", "secret123", "secretpass",
    "access123", "login123", "loginpass", "userpass1", "username1",
)

_NOMBRES_FRANQUICIAS_Y_CORRIDAS_DE_LETRAS = (
    "jennifer1", "michelle1", "michael12", "jordan23",
    "charlie12", "thomas123", "hannah123", "maggie123", "george123",
    "andrew123", "opensesame", "iamgroot1", "harrypotter", "pokemon123",
    "minecraft", "aaaaaaaa", "bbbbbbbb", "abcdefgh", "abcdefg1",
)

_ESPANOL_Y_ECUATORIANO = (
    "contraseña", "contrasena", "contrasena1", "clave1234", "clave123",
    "hola1234", "hola12345", "usuario123", "cambiar123", "megusta123",
    "amor12345", "corazon123", "estrella1", "futbol123", "campeon123",
    "ecuador123", "quito1234", "guayaquil1", "cuenca123", "loja12345",
    "miclave123", "micontrasena", "elpassword",
)

CONTRASENIAS_COMUNES = frozenset(
    _SECUENCIAS_DE_DIGITOS
    + _CAMINATAS_DE_TECLADO
    + _PALABRAS_Y_PERSONAJES
    + _AFECTO_ESTACIONES_Y_COLORES
    + _VALORES_POR_DEFECTO_DE_CUENTA
    + _NOMBRES_FRANQUICIAS_Y_CORRIDAS_DE_LETRAS
    + _ESPANOL_Y_ECUATORIANO
)


def validar_contrasenia(contrasenia: str) -> None:
    """Lanza `ValueError` con mensaje en castellano si `contrasenia` no
    cumple el piso de largo, supera el tope de bytes que bcrypt hashea, o
    está en la lista negra. No normaliza ni devuelve nada -- el llamador
    conserva el valor tal como llegó (la contraseña que se hashea es la que
    el usuario escribió, no una recortada a los bordes)."""
    normalizada = contrasenia.strip()
    if len(normalizada) < LONGITUD_MINIMA_CONTRASENIA:
        raise ValueError(
            f"La contraseña debe tener al menos {LONGITUD_MINIMA_CONTRASENIA} "
            "caracteres."
        )
    if len(normalizada.encode("utf-8")) > LONGITUD_MAXIMA_CONTRASENIA_BYTES:
        raise ValueError(
            "La contraseña es demasiado larga: no puede superar "
            f"{LONGITUD_MAXIMA_CONTRASENIA_BYTES} bytes de datos (los acentos "
            "y emoji ocupan más de un byte cada uno, así que puede ser menos "
            "caracteres de los que parece)."
        )
    if normalizada.lower() in CONTRASENIAS_COMUNES:
        raise ValueError(
            "Esa contraseña es una de las más usadas y fácil de adivinar; "
            "elija otra."
        )
