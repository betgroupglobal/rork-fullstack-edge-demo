FROM node:20-alpine

WORKDIR /app

# Copy dependency configs
COPY package*.json ./

# Install packages
RUN npm install

# Copy source and config
COPY wrangler.toml ./
COPY index.ts ./
COPY items-store.ts ./

# Expose wrangler dev port
EXPOSE 8787

# Run wrangler dev binding to all interfaces so Railway can proxy traffic
CMD ["npx", "wrangler", "dev", "--ip", "0.0.0.0", "--port", "8787", "--local"]
