# Build context is the repo root — see docker-compose.yml.
FROM node:20-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY apps/api/package.json apps/api/package.json
RUN npm ci
COPY apps/dashboard apps/dashboard
RUN npm run build --workspace apps/dashboard

FROM caddy:2-alpine
COPY infra/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/dashboard/dist /srv
