FROM node:22-slim

# ── Custom build path (isolated from Cloudflare vendor defaults) ─────────────
ARG BUILD_PATH=/proxy-build
ENV PROXY_BUILD_PATH=${BUILD_PATH}
WORKDIR /app

# Copy source from functions/ (repo root build context)
COPY functions/package*.json ./

# Install production dependencies
RUN npm install --production --no-audit --no-fund

# Copy source files
COPY functions/server.js ./
COPY functions/proxy-adapter.js ./
COPY functions/start.sh ./
COPY functions/brightdata_proxy_ca.crt ./
COPY functions/wrangler.toml ./

# Copy custom build config (optional — for frp/Pangolin/NetBird self-hosted)
COPY proxy-build/config/config.toml ./config.toml 2>/dev/null || true

# Make the startup script executable
RUN chmod +x start.sh

# Create custom paths for logs and data
RUN mkdir -p /data/logs /data/config

# Expose gateway port
EXPOSE 8787

# Run the startup script which supervises the proxy adapter and gateway server
CMD ["./start.sh"]
