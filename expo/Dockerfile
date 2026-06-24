FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --legacy-peer-deps

COPY . .

# Build the Expo web export; the backend URL is injected by the service variable
# EXPO_PUBLIC_RORK_FUNCTIONS_URL at build time.
RUN npm run build

# Install a simple static server for the exported web app
RUN npm install -g serve

EXPOSE 3000

# Railway injects $PORT; fall back to 3000 for local testing.
CMD ["sh", "-c", "serve dist -s -l ${PORT:-3000}"]
