#!/bin/bash
# =============================================================================
# Edge Gateway Proxy Build — custom build/deploy pipeline.
# Overrides Cloudflare default paths. Self-hosted ready.
#
# Usage: ./proxy-build/build.sh [--deploy] [--target docker|railway|local]
# =============================================================================
set -euo pipefail

# ── Custom build path (isolated from Cloudflare vendor defaults) ─────────────
BUILD_PATH="${BUILD_PATH:-$(cd "$(dirname "$0")" && pwd)}"
PROJECT_ROOT="$(cd "$BUILD_PATH/.." && pwd)"
DIST_DIR="${BUILD_PATH}/dist"
LOG_DIR="${BUILD_PATH}/logs"
CONFIG_DIR="${BUILD_PATH}/config"
APP_SRC="${PROJECT_ROOT}/functions"

# ── Environment ─────────────────────────────────────────────────────────────
# Source dynamic env vars if present
if [ -f "${BUILD_PATH}/.env.proxy-build" ]; then
  set -a; source "${BUILD_PATH}/.env.proxy-build"; set +a
fi

export PORT="${PORT:-8787}"
export PROXY_BUILD_PATH="${BUILD_PATH}"

# ── Parse args ──────────────────────────────────────────────────────────────
TARGET="${2:-docker}"
DEPLOY=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --deploy) DEPLOY=true; shift ;;
    --target) TARGET="$2"; shift 2 ;;
    *) shift ;;
  esac
done

# ── Ensure directories ──────────────────────────────────────────────────────
mkdir -p "${DIST_DIR}" "${LOG_DIR}" "${CONFIG_DIR}"

echo "=== Edge Gateway Proxy Build ==="
echo "BUILD_PATH: ${BUILD_PATH}"
echo "DIST_DIR:   ${DIST_DIR}"
echo "TARGET:     ${TARGET}"
echo ""

# ── Step 1: Install dependencies ────────────────────────────────────────────
echo "[1/4] Installing dependencies..."
cd "${APP_SRC}"
npm install --production --no-audit --no-fund 2>&1 | tee "${LOG_DIR}/npm-install.log"

# ── Step 2: Build TypeScript (if tsconfig present) ──────────────────────────
echo "[2/4] Building TypeScript..."
if [ -f "${APP_SRC}/tsconfig.json" ]; then
  npx tsc --noEmit 2>&1 | tee "${LOG_DIR}/tsc.log" || echo "[warn] TypeScript check had errors (non-fatal for JS runtime)"
fi

# ── Step 3: Copy artifacts to dist ──────────────────────────────────────────
echo "[3/4] Copying artifacts to ${DIST_DIR}..."
cp "${APP_SRC}/server.js" "${DIST_DIR}/server.js"
cp "${APP_SRC}/proxy-adapter.js" "${DIST_DIR}/proxy-adapter.js"
cp "${APP_SRC}/brightdata_proxy_ca.crt" "${DIST_DIR}/brightdata_proxy_ca.crt" 2>/dev/null || true
cp "${APP_SRC}/package.json" "${DIST_DIR}/package.json"
cp "${APP_SRC}/package-lock.json" "${DIST_DIR}/package-lock.json" 2>/dev/null || true
cp "${APP_SRC}/start.sh" "${DIST_DIR}/start.sh"
chmod +x "${DIST_DIR}/start.sh"

# Copy wrangler.toml for reference (server.js doesn't use it at runtime)
cp "${APP_SRC}/wrangler.toml" "${DIST_DIR}/wrangler.toml"

# Copy config templates
if [ -f "${CONFIG_DIR}/config.toml" ]; then
  cp "${CONFIG_DIR}/config.toml" "${DIST_DIR}/config.toml"
fi

echo "  Dist contents:"
ls -la "${DIST_DIR}/" | tee "${LOG_DIR}/dist-manifest.log"

# ── Step 4: Build & deploy ──────────────────────────────────────────────────
echo "[4/4] Build & deploy..."
case "${TARGET}" in
  docker)
    echo "  Building Docker image: proxy-host"
    docker build \
      -t proxy-host \
      -f "${APP_SRC}/Dockerfile" \
      --build-arg BUILD_PATH="${BUILD_PATH}" \
      "${PROJECT_ROOT}"

    if [ "${DEPLOY}" = true ]; then
      echo "  Starting container: proxy-instance"
      docker rm -f proxy-instance 2>/dev/null || true
      docker run -d \
        -v "${BUILD_PATH}:/data" \
        -p "${PORT}:8787" \
        --name proxy-instance \
        -e PROXY_BUILD_PATH="${BUILD_PATH}" \
        proxy-host
      echo "  Container started on http://0.0.0.0:${PORT}"
    fi
    ;;

  railway)
    echo "  Railway deploy — push to trigger rebuild via railway.toml"
    echo "  Ensure railway.toml points to functions/Dockerfile"
    ;;

  local)
    echo "  Starting local server..."
    cd "${DIST_DIR}"
    node server.js
    ;;

  *)
    echo "  Unknown target: ${TARGET}"
    echo "  Usage: ./build.sh [--deploy] [--target docker|railway|local]"
    exit 1
    ;;
esac

echo ""
echo "Build deployed to ${BUILD_PATH}"
echo "Done."
