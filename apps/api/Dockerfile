# Build context is the repo root (npm workspaces monorepo) — see docker-compose.yml.
FROM node:20-alpine AS base
# Prisma's query/schema engines need OpenSSL present on Alpine or they fail
# at runtime with an opaque "could not parse schema engine response" error.
RUN apk add --no-cache openssl
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/dashboard/package.json apps/dashboard/package.json
RUN npm ci

FROM base AS build
COPY apps/api apps/api
RUN npx prisma generate --schema apps/api/prisma/schema.prisma
RUN npm run build --workspace apps/api

FROM node:20-alpine AS runtime
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma

WORKDIR /repo/apps/api
EXPOSE 4317

# migrate deploy applies whatever's in prisma/migrations — never migrate dev
# (which can prompt/reset) against a running deployment.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
