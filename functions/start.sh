#!/bin/sh
set -e

# Trust the Bright Data proxy CA so the local adapter can verify proxy-signed certs.
export NODE_EXTRA_CA_CERTS="/app/brightdata_proxy_ca.crt"

# Write a .dev.vars file so wrangler dev picks up Railway-injected env vars.
cat > /app/.dev.vars <<EOF
API_KEY=${API_KEY:-}
BASE_DOMAIN=${BASE_DOMAIN:-}
PROXY_TARGET=${PROXY_TARGET:-}
ALLOWED_ORIGINS=${ALLOWED_ORIGINS:-}
RESIDENTIAL_PROXY_POOL=${RESIDENTIAL_PROXY_POOL:-}
EOF

# Start the local HTTP CONNECT proxy adapter in the background.
node /app/proxy-adapter.js &

# Start the gateway (wrangler dev in local mode).
exec npx wrangler dev --ip 0.0.0.0 --port "${PORT:-8787}" --local
