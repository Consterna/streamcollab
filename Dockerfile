# syntax=docker/dockerfile:1
# StreamCollab: one image serving the REST API, the WebSocket hub and the compiled client.

ARG NODE_VERSION=24

# ---- Build: install everything and compile shared, server and client ----
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci

COPY tsconfig.base.json tsconfig.json ./
COPY packages ./packages
RUN npm run build

# ---- Runtime: production dependencies of the server workspace only ----
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATABASE_PATH=/data/streamcollab.sqlite \
    CLIENT_DIST=/app/packages/client/dist
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci --omit=dev --ignore-scripts --workspace=packages/server --include-workspace-root=false \
    && npm cache clean --force

COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/client/dist packages/client/dist

# SQLite lives on a volume, owned by the unprivileged "node" user of the official image
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Exec form so SIGTERM reaches Node directly and triggers the graceful shutdown
CMD ["node", "packages/server/dist/index.js"]
