#!/bin/bash
# =============================================================================
# Edge Gateway Proxy Build — local build/artifact script.
# Prepares the functions/ app for deployment via railway.toml.
#
# Usage: ./proxy-build/build.sh
# =============================================================================
set -euo pipefail

# ── Paths (project-relative, no hardcoded paths) ─────────────────────────────
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
export PROXY_BUILD_PATH="${BUILD_PATH}"

# ── Ensure directories ──────────────────────────────────────────────────────
mkdir -p "${DIST_DIR}" "${LOG_DIR}" "${CONFIG_DIR}"

echo "=== Edge Gateway Proxy Build ==="
echo "BUILD_PATH: ${BUILD_PATH}"
echo "DIST_DIR:   ${DIST_DIR}"
echo ""

# ── Step 1: Install dependencies ────────────────────────────────────────────
echo "[1/3] Installing dependencies..."
cd "${APP_SRC}"
npm install --production --no-audit --no-fund 2>&1 | tee "${LOG_DIR}/npm-install.log"

# ── Step 2: Copy artifacts to dist ──────────────────────────────────────────
echo "[2/3] Copying artifacts to ${DIST_DIR}..."
cp "${APP_SRC}/server.js" "${DIST_DIR}/server.js"
cp "${APP_SRC}/proxy-adapter.js" "${DIST_DIR}/proxy-adapter.js"
cp "${APP_SRC}/brightdata_proxy_ca.crt" "${DIST_DIR}/brightdata_proxy_ca.crt" 2>/dev/null || true
cp "${APP_SRC}/package.json" "${DIST_DIR}/package.json"
cp "${APP_SRC}/package-lock.json" "${DIST_DIR}/package-lock.json" 2>/dev/null || true
cp "${APP_SRC}/start.sh" "${DIST_DIR}/start.sh"
chmod +x "${DIST_DIR}/start.sh"

# Copy wrangler.toml for reference
cp "${APP_SRC}/wrangler.toml" "${DIST_DIR}/wrangler.toml"

# Copy config templates
if [ -f "${CONFIG_DIR}/config.toml" ]; then
  cp "${CONFIG_DIR}/config.toml" "${DIST_DIR}/config.toml"
fi

echo "  Dist contents:"
ls -la "${DIST_DIR}/" | tee "${LOG_DIR}/dist-manifest.log"

# ── Step 3: Ready for deployment ────────────────────────────────────────────
echo ""
echo "[3/3] Artifacts ready at ${DIST_DIR}"
echo "  Deploy via Railway: push to trigger rebuild (railway.toml → functions/Dockerfile)"
echo "  Run locally: cd ${DIST_DIR} && node server.js"
echo ""
echo "Build complete."
