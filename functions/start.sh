#!/bin/sh
set -e

# =============================================================================
# Edge Gateway self-hosted startup — Pangolin/frp/NetBird proxy pipeline
# Zero Cloudflare dependencies. Fully self-contained proxy hosting.
# =============================================================================

# --- Runtime environment -----------------------------------------------------
export NODE_EXTRA_CA_CERTS="/app/brightdata_proxy_ca.crt"
export CI=1

PORT="${PORT:-8787}"
PROXY_PORT="${PROXY_PORT:-7000}"
HEALTH_PORT="${PORT}"

# Kimi K2.7 AI proxy (Rork Toolkit)
TOOLKIT_URL="${TOOLKIT_URL:-}"
TOOLKIT_SECRET_KEY="${TOOLKIT_SECRET_KEY:-}"

# --- Supervisor helpers ------------------------------------------------------
start_service() {
  name="$1"
  shift
  while true; do
    echo "[supervisor] starting ${name}"
    "$@" &
    pid=$!
    echo "${pid}" > "/tmp/${name}.pid"
    wait "${pid}" || true
    echo "[supervisor] ${name} exited (code $?), restarting in 1s"
    sleep 1
  done
}

cleanup() {
  echo "[supervisor] shutting down children..."
  for name in gateway proxy-manager proxy-adapter; do
    if [ -f "/tmp/${name}.pid" ]; then
      kill "$(cat "/tmp/${name}.pid")" 2>/dev/null || true
    fi
  done
  pkill -P $$ 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM EXIT

# --- Proxy manager (Pangolin/frp-style tunnel management) -------------------
echo "[start] launching proxy-manager on port ${PROXY_PORT}"
start_service proxy-manager node /app/proxy-manager.js &

# --- Optional upstream proxy adapter (Bright Data) ---------------------------
if [ -n "${BRIGHTDATA_PROXY_URL:-}" ] || [ -n "${RESIDENTIAL_PROXY_POOL:-}" ]; then
  start_service proxy-adapter node /app/proxy-adapter.js &
else
  echo "[start] no upstream proxy configured, skipping proxy adapter"
fi

# --- Gateway (API server) ----------------------------------------------------
start_service gateway node /app/server.js &

# --- Health gate: wait for gateway to be ready --------------------------------
echo "[start] waiting for gateway health on http://127.0.0.1:${HEALTH_PORT}/health"
for i in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:${HEALTH_PORT}/health" > /dev/null 2>&1; then
    echo "[start] gateway is healthy"
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "[start] gateway failed to become healthy after 60s; aborting"
    exit 1
  fi
  sleep 1
done

# --- Health watch -------------------------------------------------------------
echo "[start] entering health watch loop"
while true; do
  sleep 10
  if ! curl -sf "http://127.0.0.1:${HEALTH_PORT}/health" > /dev/null 2>&1; then
    echo "[start] gateway health check failed; restarting gateway"
    if [ -f /tmp/gateway.pid ]; then
      kill "$(cat /tmp/gateway.pid)" 2>/dev/null || true
    fi
  fi
done
