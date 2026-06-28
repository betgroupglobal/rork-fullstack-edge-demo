# Edge Gateway Dashboard

A full-stack reverse-proxy management platform for intercepting, analyzing, and replaying HTTP traffic — with a self-hosted proxy pipeline (Pangolin/frp/NetBird), AI-powered phishlet generation (Kimi K2.7), and Grok Build 0.1 server config orchestration. Zero Cloudflare dependencies.

Built with Expo Router + React Native (iOS, Android, Web) and a standalone Node.js backend.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Expo Mobile App (iOS / Android / Web)              │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐  │
│  │Dashboard│ │ Proxies  │ │Intercepts│ │ Recon  │  │
│  └─────────┘ └──────────┘ └──────────┘ └────────┘  │
│           React Query → REST API (JSON)              │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│  Gateway Server (Node.js — port 8787)               │
│  • REST API for proxies, tunnels, traffic, config   │
│  • AI pipeline: Kimi K2.7 + Grok Build 0.1          │
│  • HAR export, replay engine, auth stubs            │
└──────────────────────┬──────────────────────────────┘
                       │ internal API (port 7001)
┌──────────────────────▼──────────────────────────────┐
│  Proxy Manager (Node.js — port 7000)                │
│  • Self-hosted TCP/HTTP tunnel management           │
│  • Launch/stop child proxy server instances         │
│  • Health checks, logging, stats                    │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│  Proxy Adapter (optional — Bright Data upstream)    │
└─────────────────────────────────────────────────────┘
```

Three self-hosted processes run in the container:

| Process | Port | Role |
|---|---|---|
| **Gateway** (`server.js`) | 8787 | Public API, AI orchestration, intercept/traffic storage |
| **Proxy Manager** (`proxy-manager.js`) | 7000 (proxy) / 7001 (API) | Tunnel lifecycle, child server management |
| **Proxy Adapter** (`proxy-adapter.js`) | *optional* | Upstream residential proxy relay (Bright Data) |

---

## Quick Start

### Prerequisites

- **Node.js** ≥22 and **Bun** installed
- An API key (optional — auth is disabled when no key is set)

### Local Development (backend only)

```bash
cd functions
npm install
API_KEY=your-key node server.js
```

The gateway listens on `http://localhost:8787`. Check health:

```bash
curl http://localhost:8787/health
```

### Local Development (full stack)

```bash
# Terminal 1 — Backend
cd functions
npm install && API_KEY=my-secret node server.js

# Terminal 2 — Proxy Manager (required for tunnels)
cd functions
PROXY_PORT=7000 PROXY_API_PORT=7001 API_KEY=my-secret node proxy-manager.js

# Terminal 3 — Expo frontend
cd expo
bun install
bun run start
```

Press `i` for iOS Simulator, `a` for Android, or `w` for web.

### One-command (Docker)

```bash
docker build -t edge-gateway -f functions/Dockerfile .
docker run -p 8787:8787 -p 7000:7000 -e API_KEY=my-secret edge-gateway
```

The `start.sh` supervisor keeps all three processes running and auto-restarts on failure.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `8787` | Gateway API server port |
| `API_KEY` | No | *(empty)* | Bearer token for write operations; auth disabled when empty |
| `ALLOWED_ORIGINS` | No | `*` | Comma-separated CORS origins |
| `PROXY_PORT` | No | `7000` | Main proxy tunnel entry port |
| `PROXY_API_PORT` | No | `7001` | Proxy-manager internal API port |
| `TOOLKIT_URL` | For AI features | — | Rork Toolkit base URL (Kimi & Grok proxy) |
| `TOOLKIT_SECRET_KEY` | For AI features | — | Rork Toolkit secret key |
| `BRIGHTDATA_PROXY_URL` | No | — | Upstream residential proxy URL (enables proxy-adapter) |
| `RESIDENTIAL_PROXY_POOL` | No | — | Comma-separated proxy pool (enables proxy-adapter) |
| `PROXY_BUILD_PATH` | No | `/proxy-build` | Custom build output directory |
| `PROXY_TOKEN` | No | — | Internal proxy-manager auth token |
| `CONFIG_PATH` | No | `/app/config.toml` | Path to proxy config TOML |
| `NODE_EXTRA_CA_CERTS` | Auto | `/app/brightdata_proxy_ca.crt` | CA cert for upstream SSL |

---

## Frontend Screens

The mobile app has five tabs:

| Tab | What it does |
|---|---|
| **Dashboard** | Live health status, traffic stats, quick metrics |
| **Proxies** | Create/manage reverse-proxy targets, launch tunnels, AI server config (Grok Build 0.1), start/stop child server instances |
| **Intercepts** | View captured HTTP requests (credentials, cookies, headers), clear cache, export HAR |
| **Recon** | AI-powered phishlet generation (Kimi K2.7), run the headless agent, iterate on YAML configs |
| **Settings** | Runtime configuration (API keys, proxy pools, CORS), tunnel list management, proxy status |

### Running on a device

```bash
cd expo
bun run start        # scan QR with Expo Go or Rork app
bun run start-web    # browser preview (some native features unavailable)
```

---

## API Reference

All endpoints return JSON. Write endpoints require `Authorization: Bearer <API_KEY>` when `API_KEY` is configured.

### Health

```
GET /health
```

Returns uptime, item/proxy/intercept counts, and server metadata.

### Proxies

```
GET    /api/proxies              List all proxy targets
POST   /api/proxies              Create a proxy (body: { name, targetUrl })
PUT    /api/proxies/:id          Update proxy settings
DELETE /api/proxies/:id          Delete proxy and cascade-clear intercepts
```

### Proxy Tunnels (self-hosted)

```
GET    /api/proxy/tunnels        List all tunnels with stats
POST   /api/proxy/tunnels        Create a tunnel (body: { name, type, localIP, localPort, remotePort, autoStart })
GET    /api/proxy/tunnels/:id    Single tunnel status
POST   /api/proxy/tunnels/:id/start   Start a tunnel
POST   /api/proxy/tunnels/:id/stop    Stop a tunnel
DELETE /api/proxy/tunnels/:id    Remove a tunnel
```

### Proxy Server Instances

```
GET    /api/proxy/servers              List launched child instances
POST   /api/proxy/servers/launch       Launch a new instance (body: { port, name, config, tunnels })
POST   /api/proxy/servers/configure    Generate config via Grok Build 0.1 (body: { targetHost, ports?, tunnelCount? })
POST   /api/proxy/servers/validate     Validate config via Grok Build 0.1 (body: { config, targetHost? })
GET    /api/proxy/servers/:id          Single instance status + health
POST   /api/proxy/servers/:id/stop     Stop and clean up an instance
GET    /api/proxy/servers/:id/logs     Tail recent logs (last 10KB)
```

### Intercepts

```
GET    /api/intercepts           List captured requests (auth required)
DELETE /api/intercepts           Clear all intercepts (auth required)
GET    /api/intercepts/har       Export all intercepts as HAR 1.2 JSON (auth required)
```

### Traffic

```
GET    /api/traffic              Traffic entries with stats (total, avgLatency, errorCount, cacheHits)
```

### Runtime Config

```
GET    /api/config               Get current config (API_KEY masked)
PUT    /api/config               Set config fields (auth required)
DELETE /api/config               Clear all config (auth required)
```

Valid config fields: `ALLOWED_ORIGINS`, `INTERCEPT_LAB_MODE`, `INTERCEPT_ALLOWLIST`, `INTERCEPT_BLOCKLIST`, `INTERCEPT_TTL_SECONDS`, `API_KEY`, `CF_API_KEY`, `CF_API_EMAIL`, `CF_API_TOKEN`, `PROXY_TARGET`, `BASE_DOMAIN`, `RESIDENTIAL_PROXY_POOL`.

### AI-Powered Recon

```
POST   /api/proxies/:id/recon             Generate phishlet from captured form data (Kimi K2.7)
POST   /api/proxies/:id/login-phishlet    Generate phishlet from login form structure (Kimi K2.7)
POST   /api/proxies/:id/recon/iterate     Critique and improve existing phishlet (Kimi K2.7)
```

### Proxy Status (Cloudflare compat stubs)

```
GET    /api/proxy/status          Overall proxy health (tunnel count, bytes transferred, active conns)
GET    /api/cloudflare/zones      Tunnel list mapped as zone objects for frontend compat
POST   /api/cloudflare/allocate   Create a tunnel for a proxy allocation
GET    /api/cloudflare/wildcard   Proxy status stub
GET    /api/cloudflare/worker-routes   Tunnel list mapped as route objects
DELETE /api/cloudflare/worker-routes/:zoneId/:routeId   Delete tunnel by ID
```

---

## AI Features

### Kimi K2.7 Code High Speed — Phishlet Generation

The gateway uses `moonshotai/kimi-k2.7-code-highspeed` via the Rork Toolkit proxy to:

- **Generate** — construct Evilginx2-compatible YAML phishlets from captured form data
- **Login** — build targeted phishlets from login form structure
- **Iterate** — critique and improve existing phishlets with scored findings

When AI is unavailable (no `TOOLKIT_URL`/`TOOLKIT_SECRET_KEY`), a deterministic fallback stub is returned.

### Grok Build 0.1 — Server Config Orchestration

The gateway uses `xai/grok-build-0.1` to:

- **Generate** — produce optimal TOML proxy server configs for target hosts
- **Validate** — check configs for port collisions, missing health checks, invalid types
- **Optimize** — improve existing configs with scoring and change explanations

---

## Self-Hosted Proxy Pipeline

The project has migrated entirely away from Cloudflare Workers. The proxy pipeline runs as a self-contained set of Node.js processes:

### Proxy Manager (`proxy-manager.js`)

- TCP/HTTP tunnel lifecycle (create, start, stop, delete)
- Per-tunnel stats: bytes in/out, active connections, uptime
- Child server instance management — spawn, health check, log tail, graceful kill
- Config loaded from TOML (`proxy-build/config/config.toml`)
- Event emitter for tunnel/server lifecycle events

### Proxy Build (`proxy-build/build.sh`)

Prepares and validates all artifacts for deployment:

```bash
./proxy-build/build.sh
```

Steps: install deps → copy artifacts to `proxy-build/dist/` → validate required files → ready for deploy.

Deploy options after build:
- **Railway**: push to trigger rebuild (uses `railway.toml` → `functions/Dockerfile`)
- **Docker**: `docker build -t edge-gateway -f functions/Dockerfile .`
- **Local**: `cd proxy-build/dist && node server.js & node proxy-manager.js`

### Config (`proxy-build/config/config.toml`)

TOML file defining server bind, logging, health checks, gateway integration, auth, and tunnel definitions. Tunnels defined here auto-start on container boot. NetBird mesh networking is configurable (optional).

---

## Agent Tools

Two standalone CLI agents live in `agents/`:

### Phishlet Constructor (`agents/phishlet-constructor.ts`)

Puppeteer-based agent that navigates a target, extracts login form structure, and builds a deterministic phishlet YAML. Requires `--authorized` flag or `ALLOWED_TARGETS` env var.

```bash
cd agents
npm install
npx tsx phishlet-constructor.ts --target-url https://example.com/login --authorized
```

Integrates with the gateway by setting `GATEWAY_BASE_URL` and `GATEWAY_API_KEY`.

### AI Phishlet Agent (`agents/ai-phishlet.ts`)

Kimi K2.7-powered agent — no browser required. Reads target URL + optional captured JSON, generates or verifies phishlet YAMLs.

```bash
# Generate a new phishlet
TOOLKIT_URL=https://toolkit.rork.app \
TOOLKIT_SECRET_KEY=sk_... \
npx tsx agents/ai-phishlet.ts construct --target-url https://example.com/login --authorized

# Verify and improve an existing phishlet
npx tsx agents/ai-phishlet.ts verify --phishlet ./phishlets/example.yaml --authorized --output ./phishlets/improved.yaml
```

Both agents enforce authorization — they refuse to run against targets you don't explicitly authorize.

---

## Project Structure

```
├── expo/                          # React Native mobile app
│   ├── app/
│   │   ├── (tabs)/               # 5 tab screens
│   │   │   ├── index.tsx         # Dashboard
│   │   │   ├── proxies.tsx       # Proxy management + server instances
│   │   │   ├── intercepts.tsx    # Captured request viewer
│   │   │   ├── recon.tsx         # AI phishlet generation
│   │   │   ├── settings.tsx      # Runtime config + tunnel list
│   │   │   └── _layout.tsx       # Tab bar with animations
│   │   ├── _layout.tsx           # Root layout + React Query provider
│   │   ├── items.tsx             # CRUD items screen
│   │   └── modal.tsx             # Modal overlay
│   ├── components/               # Reusable UI components (18 files)
│   ├── constants/
│   │   ├── styles.ts             # Shared style system
│   │   └── theme.ts              # Brand colors & typography
│   ├── hooks/
│   │   ├── useGateway.ts         # All React Query hooks (488 lines)
│   │   └── useApiKey.ts          # API key from secure storage
│   └── lib/
│       ├── api/                   # Typed API client (split into modules)
│       │   ├── client.ts         # fetch wrapper + auth
│       │   ├── constants.ts      # Sensitive field masks
│       │   ├── endpoints.ts      # All API call functions
│       │   ├── index.ts          # Barrel exports
│       │   └── types.ts          # TypeScript interfaces
│       └── scripts/              # Frontend capture/login-probe scripts
├── functions/                    # Backend server
│   ├── server.js                 # Gateway API (1357 lines)
│   ├── proxy-manager.js          # Tunnel + instance manager
│   ├── proxy-adapter.js          # Upstream proxy relay
│   ├── start.sh                  # Supervisor (auto-restart)
│   ├── Dockerfile                # Container build
│   └── brightdata_proxy_ca.crt   # CA cert for upstream SSL
├── agents/                       # CLI tools
│   ├── phishlet-constructor.ts   # Puppeteer-based phishlet agent
│   ├── ai-phishlet.ts            # Kimi K2.7 AI phishlet agent
│   ├── package.json
│   └── README.md
├── proxy-build/                  # Self-hosted proxy build pipeline
│   ├── build.sh                  # Build + validate script
│   ├── config/
│   │   └── config.toml           # Proxy tunnel configuration
│   └── logs/
├── railway.toml                  # Railway deploy config
└── rork.json                     # Project manifest
```

---

## Deployment

### Railway

The project auto-deploys to Railway via `railway.toml`:

```bash
# Trigger a rebuild after proxy-build:
./proxy-build/build.sh
git push
```

### Docker (any cloud)

```bash
docker build -t edge-gateway -f functions/Dockerfile .
docker run -p 8787:8787 -p 7000:7000 \
  -e API_KEY=my-secret \
  -e TOOLKIT_URL=https://toolkit.rork.app \
  -e TOOLKIT_SECRET_KEY=sk_... \
  edge-gateway
```

The container starts `start.sh` which supervises all three processes.

### Local bare-metal

```bash
./proxy-build/build.sh
cd proxy-build/dist
API_KEY=my-secret node server.js &
PROXY_PORT=7000 PROXY_API_PORT=7001 node proxy-manager.js &
```

---

## Mobile App Deployment

```bash
cd expo

# iOS App Store
bun i -g @expo/eas-cli
eas build:configure
eas build --platform ios
eas submit --platform ios

# Google Play
eas build --platform android
eas submit --platform android

# Web
eas build --platform web
```

---

## Troubleshooting

### Backend not responding?

```bash
# Check gateway health
curl http://localhost:8787/health

# Check proxy manager
curl http://localhost:7001/health

# Check Docker logs
docker logs <container-id>
```

### AI features not working?

Ensure both `TOOLKIT_URL` and `TOOLKIT_SECRET_KEY` are set. The gateway falls back to deterministic stubs when AI is unavailable — no errors, just less accurate results.

### Tunnels won't start?

1. Verify port ranges don't collide (proxy manager uses 10000-50000 range for remote ports)
2. Check the config TOML at `proxy-build/config/config.toml`
3. Review proxy-manager logs: `docker logs <container> | grep proxy-manager`

### Expo app blanks on API calls?

1. Make sure the backend is running and accessible
2. Check the base URL in `expo/lib/api/client.ts`
3. Set `API_KEY` on the backend and enter it in the app's Settings tab
