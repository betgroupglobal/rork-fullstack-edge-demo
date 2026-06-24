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

# --- Worker config -----------------------------------------------------------
# Write a .dev.vars file so wrangler dev picks up the platform-injected env vars.
cat > /app/.dev.vars <<EOF
API_KEY=${API_KEY:-}
BASE_DOMAIN=${BASE_DOMAIN:-}
PROXY_TARGET=${PROXY_TARGET:-}
ALLOWED_ORIGINS=${ALLOWED_ORIGINS:-}
RESIDENTIAL_PROXY_POOL=${RESIDENTIAL_PROXY_POOL:-}
EOF

# --- Optional proxy adapter --------------------------------------------------
# proxy-adapter.js exits(1) when no upstream proxy is configured. Only launch it
# when one is present so its failure never adds noise to the container logs.
if [ -n "${BRIGHTDATA_PROXY_URL:-}" ] || [ -n "${RESIDENTIAL_PROXY_POOL:-}" ]; then
  echo "[start] launching proxy adapter"
  node /app/proxy-adapter.js &
else
  echo "[start] no upstream proxy configured, skipping proxy adapter"
fi

# --- Gateway -----------------------------------------------------------------
echo "[start] starting wrangler dev on 0.0.0.0:${PORT}"
exec npx wrangler dev \
  --ip 0.0.0.0 \
  --port "${PORT}" \
  --local \
  --show-interactive-dev-session=false
