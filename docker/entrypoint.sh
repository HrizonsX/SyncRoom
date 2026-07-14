#!/usr/bin/env bash
set -euo pipefail

pids=()

log() {
  printf '[syncroom-entrypoint] %s\n' "$*"
}

start_background() {
  "$@" &
  pids+=("$!")
}

stop_children() {
  if [ "${#pids[@]}" -eq 0 ]; then
    return
  fi
  kill -TERM "${pids[@]}" 2>/dev/null || true
  wait "${pids[@]}" 2>/dev/null || true
}

trap stop_children EXIT INT TERM

export SYNCROOM_HTTP_PORT="${SYNCROOM_HTTP_PORT:-8787}"
export PORT="${PORT:-8788}"
export MEDIA_EXTRACTOR_HOST="${MEDIA_EXTRACTOR_HOST:-127.0.0.1}"
export MEDIA_EXTRACTOR_PORT="${MEDIA_EXTRACTOR_PORT:-8790}"
export MEDIA_EXTRACTOR_BASE_URL="${MEDIA_EXTRACTOR_BASE_URL:-http://127.0.0.1:${MEDIA_EXTRACTOR_PORT}}"
export NGINX_CACHE_METRICS_PORT="${NGINX_CACHE_METRICS_PORT:-5514}"
export SYNCROOM_REDIS_MODE="${SYNCROOM_REDIS_MODE:-embedded}"
export SYNCROOM_MEDIA_EXTRACTOR_MODE="${SYNCROOM_MEDIA_EXTRACTOR_MODE:-embedded}"
export SYNCROOM_LIVEKIT_MODE="${SYNCROOM_LIVEKIT_MODE:-embedded}"
export SYNCROOM_NGINX_CACHE_MAX_SIZE="${SYNCROOM_NGINX_CACHE_MAX_SIZE:-2g}"
export SYNCROOM_NGINX_CACHE_INACTIVE="${SYNCROOM_NGINX_CACHE_INACTIVE:-10m}"
export SYNCROOM_NGINX_CACHE_VALID="${SYNCROOM_NGINX_CACHE_VALID:-60s}"
export SYNCROOM_NGINX_CACHE_LOCK_TIMEOUT="${SYNCROOM_NGINX_CACHE_LOCK_TIMEOUT:-10s}"
export SYNCROOM_NGINX_CACHE_LOCK_AGE="${SYNCROOM_NGINX_CACHE_LOCK_AGE:-10s}"
export SYNCROOM_NGINX_SLICE_SIZE="${SYNCROOM_NGINX_SLICE_SIZE:-256k}"
export LIVEKIT_PORT="${LIVEKIT_PORT:-7880}"
export LIVEKIT_RTC_TCP_PORT="${LIVEKIT_RTC_TCP_PORT:-7881}"
export LIVEKIT_RTC_PORT_RANGE_START="${LIVEKIT_RTC_PORT_RANGE_START:-50000}"
export LIVEKIT_RTC_PORT_RANGE_END="${LIVEKIT_RTC_PORT_RANGE_END:-60000}"
export LIVEKIT_USE_EXTERNAL_IP="${LIVEKIT_USE_EXTERNAL_IP:-false}"

if [ "$SYNCROOM_REDIS_MODE" = "embedded" ]; then
  export SYNCROOM_REDIS_PORT="${SYNCROOM_REDIS_PORT:-6379}"
  export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:${SYNCROOM_REDIS_PORT}}"
  export ROOM_STORE_PROVIDER="${ROOM_STORE_PROVIDER:-redis}"
  export RUNTIME_STORE_PROVIDER="${RUNTIME_STORE_PROVIDER:-redis}"
  export ROOM_EVENT_BUS_PROVIDER="${ROOM_EVENT_BUS_PROVIDER:-redis}"
  export ADMIN_COMMAND_BUS_PROVIDER="${ADMIN_COMMAND_BUS_PROVIDER:-redis}"
  export ADMIN_SESSION_STORE_PROVIDER="${ADMIN_SESSION_STORE_PROVIDER:-redis}"
  export ADMIN_EVENT_STORE_PROVIDER="${ADMIN_EVENT_STORE_PROVIDER:-redis}"
  export ADMIN_AUDIT_STORE_PROVIDER="${ADMIN_AUDIT_STORE_PROVIDER:-redis}"
  export NODE_HEARTBEAT_ENABLED="${NODE_HEARTBEAT_ENABLED:-true}"
  start_background redis-server \
    --bind 127.0.0.1 \
    --port "$SYNCROOM_REDIS_PORT" \
    --dir /var/lib/syncroom/redis \
    --appendonly yes \
    --daemonize no \
    --logfile ""
  log "embedded Redis started on 127.0.0.1:${SYNCROOM_REDIS_PORT}"
fi

if [ "$SYNCROOM_MEDIA_EXTRACTOR_MODE" = "embedded" ]; then
  start_background /opt/syncroom/services/media-extractor-service/.venv/bin/python \
    /opt/syncroom/services/media-extractor-service/app.py
  log "embedded media extractor started on ${MEDIA_EXTRACTOR_HOST}:${MEDIA_EXTRACTOR_PORT}"
fi

if [ "$SYNCROOM_LIVEKIT_MODE" = "embedded" ]; then
  export VOICE_ENABLED="${VOICE_ENABLED:-true}"
  export LIVEKIT_API_KEY="${LIVEKIT_API_KEY:-syncroom}"
  if [ -z "${LIVEKIT_API_SECRET:-}" ]; then
    LIVEKIT_API_SECRET="$(openssl rand -hex 32)"
    export LIVEKIT_API_SECRET
    log "generated ephemeral LIVEKIT_API_SECRET for embedded LiveKit"
  fi
  export LIVEKIT_URL="${LIVEKIT_URL:-ws://localhost:${SYNCROOM_HTTP_PORT}/livekit}"
  cat > /run/syncroom/livekit.yaml <<EOF
port: ${LIVEKIT_PORT}
log_level: ${LIVEKIT_LOG_LEVEL:-info}
rtc:
  tcp_port: ${LIVEKIT_RTC_TCP_PORT}
  port_range_start: ${LIVEKIT_RTC_PORT_RANGE_START}
  port_range_end: ${LIVEKIT_RTC_PORT_RANGE_END}
  use_external_ip: ${LIVEKIT_USE_EXTERNAL_IP}
redis:
  address: 127.0.0.1:${SYNCROOM_REDIS_PORT:-6379}
keys:
  ${LIVEKIT_API_KEY}: ${LIVEKIT_API_SECRET}
EOF
  start_background /usr/local/bin/livekit-server --config /run/syncroom/livekit.yaml
  log "embedded LiveKit started on 127.0.0.1:${LIVEKIT_PORT}"
fi

export ALLOW_ANY_ORIGIN_IN_DEV="${ALLOW_ANY_ORIGIN_IN_DEV:-true}"
export INSTANCE_ID="${INSTANCE_ID:-syncroom-container}"
export EMPTY_ROOM_TTL_MS="${EMPTY_ROOM_TTL_MS:-60000}"

envsubst '${SYNCROOM_HTTP_PORT} ${PORT} ${LIVEKIT_PORT} ${NGINX_CACHE_METRICS_PORT} ${SYNCROOM_NGINX_CACHE_MAX_SIZE} ${SYNCROOM_NGINX_CACHE_INACTIVE} ${SYNCROOM_NGINX_CACHE_VALID} ${SYNCROOM_NGINX_CACHE_LOCK_TIMEOUT} ${SYNCROOM_NGINX_CACHE_LOCK_AGE} ${SYNCROOM_NGINX_SLICE_SIZE}' \
  < /etc/nginx/templates/syncroom.conf.template \
  > /etc/nginx/conf.d/syncroom.conf
rm -f /etc/nginx/conf.d/default.conf
nginx -t

start_background /usr/local/bin/node /opt/syncroom/server/dist/index.js
log "syncRoom server started on 127.0.0.1:${PORT}"

start_background nginx -g 'daemon off;'
log "Nginx public entry started on :${SYNCROOM_HTTP_PORT}"

wait -n "${pids[@]}"
exit_code="$?"
log "a managed process exited with status ${exit_code}; stopping container"
exit "$exit_code"
