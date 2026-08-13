FROM python:3.13.5-slim

RUN pip install --no-cache-dir uv==0.8.3

WORKDIR /app

# Install deps first (better layer caching) — --frozen so the lock file
# (which pins bcrypt<4.1 for passlib compatibility) is respected exactly.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project

COPY . .
RUN uv sync --frozen

RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser \
    && mkdir -p /home/appuser/.cache/uv \
    && chown -R appuser:appgroup /home/appuser \
    && chown -R appuser:appgroup /app
ENV HOME=/home/appuser
USER appuser

EXPOSE 8000

# `--proxy-headers --forwarded-allow-ips=172.16.0.0/12` (issue #235): sin
# esto, el backend nunca ve al visitante real -- su peer TCP es siempre el
# contenedor `frontend` (el BFF de Next.js lo llama server-side), así que
# `get_remote_address` (rate_limit.py) devuelve la misma IP para todo
# internet y el rate limit anónimo termina siendo un único cubo compartido
# por todos los visitantes.
#
# `172.16.0.0/12` (172.16.0.0-172.31.255.255) y NO un /16 puntual: ninguno de
# los docker-compose*.yml de este repo fija `subnet` -- Docker asigna el /16
# de cada red `<proyecto>_default` dinámicamente del pool 172.17-172.31/16
# (verificado: los stacks compose corriendo en paralelo en esta máquina ya
# ocupan 172.17 a 172.24), así que un valor fijo se rompería según qué otros
# stacks tenga arriba el host, en dev o en producción. `/12` es el rango
# COMPLETO del que Docker reparte esas subredes -- sigue siendo privado
# (RFC 1918), nunca alcanza a internet.
#
# NUNCA "*": permitiría que cualquiera en internet mande su propia
# X-Forwarded-For y estrene un cubo de rate limit por request -- sería PEOR
# que el bug que esto arregla, porque ni siquiera compartir un cubo global
# lo frenaría.
CMD ["uv", "run", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips=172.16.0.0/12"]
