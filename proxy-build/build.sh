#!/bin/bash
# =============================================================================
# Edge Gateway self-hosted proxy build — Pangolin/frp/NetBird pipeline
# Prepares and deploys the functions/ app as a self-contained proxy host.
#
# Usage: ./proxy-build/build.sh
# =============================================================================
set -euo pipefail

# ── Paths (project-relative, no vendor lock-in) ──────────────────────────────
BUILD_PATH="${BUILD_PATH:-$(cd "$(dirname "$0")" && pwd)}"
PROJECT_ROOT="$(cd "$BUILD_PATH/.." && pwd)"
DIST_DIR="${BUILD_PATH}/dist"
LOG_DIR="${BUILD_PATH}/logs"
CONFIG_DIR="${BUILD_PATH}/config"
APP_SRC="${PROJECT_ROOT}/functions"

# ── Environment ─────────────────────────────────────────────────────────────
if [ -f "${BUILD_PATH}/.env.proxy-build" ]; then
  set -a; source "${BUILD_PATH}/.env.proxy-build"; set +a
fi

export PORT="${PORT:-8787}"
export PROXY_PORT="${PROXY_PORT:-7000}"
export PROXY_API_PORT="${PROXY_API_PORT:-7001}"
export PROXY_BUILD_PATH="${BUILD_PATH}"

# ── Ensure directories ──────────────────────────────────────────────────────
mkdir -p "${DIST_DIR}" "${LOG_DIR}"

echo "======================================"
echo " Edge Gateway Proxy Build"
echo "   Pangolin/frp/NetBird self-hosted"
echo "======================================"
echo ""
echo "BUILD_PATH:  ${BUILD_PATH}"
echo "DIST_DIR:    ${DIST_DIR}"
echo "APP_SRC:     ${APP_SRC}"
echo "PROXY_PORT:  ${PROXY_PORT} (tunnel entry)"
echo "API_PORT:    ${PROXY_API_PORT} (proxy-manager API)"
echo ""

# ── Step 1: Install dependencies ────────────────────────────────────────────
echo "[1/4] Installing dependencies..."
cd "${APP_SRC}"
npm install --production --no-audit --no-fund 2>&1 | tee "${LOG_DIR}/npm-install.log"
echo ""

# ── Step 2: Copy artifacts to dist ──────────────────────────────────────────
echo "[2/4] Copying artifacts to ${DIST_DIR}..."
cp "${APP_SRC}/server.js" "${DIST_DIR}/server.js"
cp "${APP_SRC}/proxy-manager.js" "${DIST_DIR}/proxy-manager.js"
cp "${APP_SRC}/proxy-adapter.js" "${DIST_DIR}/proxy-adapter.js"
cp "${APP_SRC}/brightdata_proxy_ca.crt" "${DIST_DIR}/brightdata_proxy_ca.crt" 2>/dev/null || true
cp "${APP_SRC}/package.json" "${DIST_DIR}/package.json"
cp "${APP_SRC}/package-lock.json" "${DIST_DIR}/package-lock.json" 2>/dev/null || true
cp "${APP_SRC}/start.sh" "${DIST_DIR}/start.sh"
chmod +x "${DIST_DIR}/start.sh"

# Copy config
cp "${CONFIG_DIR}/config.toml" "${DIST_DIR}/config.toml"

# Copy node_modules for offline deployment
cp -r "${APP_SRC}/node_modules" "${DIST_DIR}/node_modules" 2>/dev/null || true

echo "  Dist contents:"
ls -la "${DIST_DIR}/" | tee "${LOG_DIR}/dist-manifest.log"
echo ""

# ── Step 3: Validate artifacts ──────────────────────────────────────────────
echo "[3/4] Validating artifacts..."
FAIL=0
for file in server.js proxy-manager.js proxy-adapter.js start.sh config.toml; do
  if [ ! -f "${DIST_DIR}/${file}" ]; then
    echo "  MISSING: ${file}"
    FAIL=1
  fi
done
if [ "${FAIL}" -eq 1 ]; then
  echo "  Validation FAILED — missing required artifacts"
  exit 1
fi
echo "  All required artifacts present"
echo ""

# ── Step 4: Ready ───────────────────────────────────────────────────────────
echo "[4/4] Artifacts ready at ${DIST_DIR}"
echo ""
echo "Deploy options:"
echo "  Railway:    push to trigger rebuild (railway.toml → functions/Dockerfile)"
echo "  Docker:     docker build -t edge-gateway -f functions/Dockerfile ."
echo "  Local:      cd ${DIST_DIR} && node server.js & node proxy-manager.js"
echo ""
echo "Build complete. Zero Cloudflare dependencies."
