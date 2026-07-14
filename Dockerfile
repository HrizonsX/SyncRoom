ARG NODE_VERSION=20.20.2
ARG LIVEKIT_IMAGE=livekit/livekit-server:v1.12.0
ARG PYTHON_IMAGE=python:3.11.13-slim-bookworm
ARG REDIS_IMAGE=redis:6.2.20

FROM node:${NODE_VERSION}-bookworm-slim AS node-runtime

FROM node:${NODE_VERSION}-bookworm-slim AS app-builder
WORKDIR /workspace

COPY package.json package-lock.json ./
COPY packages/protocol/package.json packages/protocol/package.json
COPY server/package.json server/package.json
COPY extension/package.json extension/package.json
COPY apps/web-room/package.json apps/web-room/package.json
RUN npm ci

COPY tsconfig.base.json ./
COPY packages packages
COPY server server
COPY extension extension
COPY apps apps
COPY scripts scripts
RUN npm run build -w @syncroom/protocol \
  && npm run build -w @syncroom/server \
  && npm run build -w @syncroom/web-room \
  && npm prune --omit=dev

FROM ${LIVEKIT_IMAGE} AS livekit

FROM ${PYTHON_IMAGE} AS python-runtime

FROM ${REDIS_IMAGE} AS redis

FROM nginx:1.26-bookworm AS runtime

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    gettext-base \
    openssl \
    procps \
  && rm -rf /var/lib/apt/lists/*

COPY --from=python-runtime /usr/local /usr/local
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/bin/corepack /usr/local/bin/corepack
COPY --from=node-runtime /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
  && ln -sf /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

COPY --from=livekit /livekit-server /usr/local/bin/livekit-server
COPY --from=redis /usr/local/bin/redis-server /usr/local/bin/redis-server
COPY --from=redis /usr/local/bin/redis-cli /usr/local/bin/redis-cli

WORKDIR /opt/syncroom
COPY --from=app-builder /workspace/package.json /workspace/package-lock.json ./
COPY --from=app-builder /workspace/node_modules ./node_modules
COPY --from=app-builder /workspace/packages/protocol/package.json ./packages/protocol/package.json
COPY --from=app-builder /workspace/packages/protocol/dist ./packages/protocol/dist
COPY --from=app-builder /workspace/server/package.json ./server/package.json
COPY --from=app-builder /workspace/server/dist ./server/dist
COPY --from=app-builder /workspace/server/admin-ui ./server/admin-ui
COPY --from=app-builder /workspace/apps/web-room/package.json ./apps/web-room/package.json
COPY --from=app-builder /workspace/apps/web-room/dist ./apps/web-room/dist
COPY services/media-extractor-service ./services/media-extractor-service

RUN python3 -m venv /opt/syncroom/services/media-extractor-service/.venv \
  && /opt/syncroom/services/media-extractor-service/.venv/bin/pip install --no-cache-dir -r /opt/syncroom/services/media-extractor-service/requirements.txt \
  && mkdir -p /var/cache/nginx/syncroom-proxy-segment /run/syncroom /var/lib/syncroom/redis \
  && chown -R nginx:nginx /var/cache/nginx/syncroom-proxy-segment

COPY docker/nginx-syncroom.conf.template /etc/nginx/templates/syncroom.conf.template
COPY docker/entrypoint.sh /usr/local/bin/syncroom-entrypoint.sh
RUN chmod +x /usr/local/bin/syncroom-entrypoint.sh

ENV NODE_ENV=production \
  SYNCROOM_HTTP_PORT=8787 \
  PORT=8788 \
  MEDIA_EXTRACTOR_HOST=127.0.0.1 \
  MEDIA_EXTRACTOR_PORT=8790 \
  NGINX_CACHE_METRICS_PORT=5514 \
  SYNCROOM_REDIS_MODE=embedded \
  SYNCROOM_MEDIA_EXTRACTOR_MODE=embedded \
  SYNCROOM_LIVEKIT_MODE=embedded

EXPOSE 8787/tcp 7881/tcp 50000-60000/udp

ENTRYPOINT ["/usr/local/bin/syncroom-entrypoint.sh"]
