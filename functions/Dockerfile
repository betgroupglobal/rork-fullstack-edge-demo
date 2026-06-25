FROM node:22-slim

WORKDIR /app

# Copy dependency configs (paths are relative to the repo root build context)
COPY functions/package*.json ./

# Install packages
RUN npm install

# Copy source and config
COPY functions/server.js ./
COPY functions/wrangler.toml ./
COPY functions/index.ts ./
COPY functions/items-store.ts ./
COPY functions/proxy-adapter.js ./
COPY functions/start.sh ./
COPY functions/brightdata_proxy_ca.crt ./

# Make the startup script executable
RUN chmod +x start.sh

# Expose wrangler dev port
EXPOSE 8787

# Run the startup script, which supervises the proxy adapter and the wrangler gateway.
CMD ["./start.sh"]
