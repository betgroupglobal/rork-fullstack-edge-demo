#!/bin/sh
set -e

# --- Runtime environment -----------------------------------------------------
# Trust the Bright Data proxy CA so the local adapter can verify proxy-signed certs.
export NODE_EXTRA_CA_CERTS="/app/brightdata_proxy_ca.crt"

# Wrangler runs in a headless container: disable telemetry, update checks, and the
# interactive dev session so the process never blocks waiting on a TTY.
export WRANGLER_SEND_METRICS=false
export CI=1

PORT="${PORT:-8787}"
HEALTH_PORT="${PORT}"

# --- Worker config -----------------------------------------------------------
# Write a .dev.vars file so wrangler dev picks up the platform-injected env vars.
cat > /app/.dev.vars <<EOF
API_KEY=${API_KEY:-}
BASE_DOMAIN=${BASE_DOMAIN:-}
PROXY_TARGET=${PROXY_TARGET:-}
ALLOWED_ORIGINS=${ALLOWED_ORIGINS:-}
RESIDENTIAL_PROXY_POOL=${RESIDENTIAL_PROXY_POOL:-}
EOF

# --- Supervisor helpers ------------------------------------------------------
# Start a named service and restart it immediately if it exits. Each service runs
# in its own background loop so the failure of one never takes the whole container down.
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

# Kill any supervised children on shutdown so the container exits cleanly.
cleanup() {
  echo "[supervisor] shutting down children..."
  for name in wrangler proxy-adapter; do
    if [ -f "/tmp/${name}.pid" ]; then
      kill "$(cat "/tmp/${name}.pid")" 2>/dev/null || true
    fi
  done
  # Also terminate the supervisor loops themselves.
  pkill -P $$ 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM EXIT

# --- Optional proxy adapter --------------------------------------------------
# proxy-adapter.js exits(1) when no upstream proxy is configured. Only launch it
# when one is present so its failure never adds noise to the container logs.
if [ -n "${BRIGHTDATA_PROXY_URL:-}" ] || [ -n "${RESIDENTIAL_PROXY_POOL:-}" ]; then
  start_service proxy-adapter node /app/proxy-adapter.js &
else
  echo "[start] no upstream proxy configured, skipping proxy adapter"
fi

# --- Gateway -----------------------------------------------------------------
# Use the locally installed wrangler binary directly so startup is fast and
# does not depend on npx resolution.
start_service wrangler /app/node_modules/.bin/wrangler dev \
  --ip 0.0.0.0 \
  --port "${PORT}" \
  --local \
  --show-interactive-dev-session=false &

# --- Gated startup: wait for the gateway to be ready -------------------------
echo "[start] waiting for gateway health on http://127.0.0.1:${HEALTH_PORT}/health"
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 43 44 45 46 47 48 49 50 51 52 53 54 55 56 57 58 59 60; do
  if node -e "require('http').get('http://127.0.0.1:${HEALTH_PORT}/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))" 2>/dev/null; then
    echo "[start] gateway is healthy"
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "[start] gateway failed to become healthy after 60s; aborting"
    exit 1
  fi
  sleep 1
done

# --- Health watch: keep the container alive as long as the gateway responds ---
echo "[start] entering health watch loop"
while true; do
  sleep 10
  if ! node -e "require('http').get('http://127.0.0.1:${HEALTH_PORT}/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))" 2>/dev/null; then
    echo "[start] gateway health check failed; restarting wrangler"
    if [ -f /tmp/wrangler.pid ]; then
      kill "$(cat /tmp/wrangler.pid)" 2>/dev/null || true
    fi
  fi
done
