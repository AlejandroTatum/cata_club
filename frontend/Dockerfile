FROM node:20-alpine AS base
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS builder
WORKDIR /app
COPY . .

# NEXT_PUBLIC_* vars are inlined into the client bundle at build time,
# so they must be build args, not just runtime env vars.
ARG NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
ARG NEXT_PUBLIC_APP_NAME="Cata Club Admin"
ARG NEXT_PUBLIC_USE_MOCKS=false
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME \
    NEXT_PUBLIC_USE_MOCKS=$NEXT_PUBLIC_USE_MOCKS

RUN pnpm build

FROM base AS runner
WORKDIR /app
# `server.js` del build standalone bindea a `process.env.HOSTNAME`, y Docker
# inyecta ahí el ID del contenedor. Ese nombre no siempre resuelve dentro de la
# red de compose, y cuando falla el arranque muere con
# `getaddrinfo EAI_AGAIN <id>` en bucle de reinicio — el contenedor nunca llega
# a escuchar. Fijarlo a 0.0.0.0 hace que escuche en todas las interfaces, que es
# lo que necesita para que el mapeo de puertos del host llegue a él.
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

RUN addgroup --system nodegroup && adduser --system --ingroup nodegroup nodeuser \
    && mkdir -p /app/.next/cache \
    && chown -R nodeuser:nodegroup /app
USER nodeuser

EXPOSE 3000
CMD ["node", "server.js"]
