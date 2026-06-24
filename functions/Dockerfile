FROM node:22-slim

WORKDIR /app

# Copy dependency configs (paths are relative to the repo root build context)
COPY functions/package*.json ./

# Install packages
RUN npm install

# Copy source and config
COPY functions/wrangler.toml ./
COPY functions/index.ts ./
COPY functions/items-store.ts ./

# Expose wrangler dev port
EXPOSE 8787

# Run wrangler dev binding to all interfaces on the Railway-injected PORT.
CMD ["sh", "-c", "npx wrangler dev --ip 0.0.0.0 --port ${PORT:-8787} --local"]
