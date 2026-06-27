FROM node:22-slim

# ── Self-hosted proxy pipeline (Pangolin/frp/NetBird — no Cloudflare deps) ──
ARG BUILD_PATH=/proxy-build
ENV PROXY_BUILD_PATH=${BUILD_PATH}
WORKDIR /app

# Copy source from functions/ (repo root build context)
COPY functions/package*.json ./

# Install production dependencies
RUN npm install --production --no-audit --no-fund

# Copy source files
COPY functions/server.js ./
COPY functions/proxy-manager.js ./
COPY functions/proxy-adapter.js ./
COPY functions/start.sh ./
COPY functions/brightdata_proxy_ca.crt ./

# Copy self-hosted proxy config (Pangolin/frp/NetBird)
COPY proxy-build/config/config.toml ./config.toml

# Make the startup script executable
RUN chmod +x start.sh

# Create custom paths for logs, data, and proxy tunnel state
RUN mkdir -p /data/logs /data/config /data/tunnels

# Expose gateway API + proxy tunnel ports
EXPOSE 8787 7000

# Run the startup script which supervises the proxy manager and gateway server
CMD ["./start.sh"]
