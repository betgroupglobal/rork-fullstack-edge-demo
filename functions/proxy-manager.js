// =============================================================================
// Edge Gateway self-hosted proxy manager — Pangolin/frp/NetBird-style
// Manages proxy tunnels, routing, and health without Cloudflare dependencies.
//
// Replaces: Cloudflare zone/DNS/Worker-route management with self-hosted tunnels.
// =============================================================================

import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import { EventEmitter } from "node:events";

// ── Configuration ────────────────────────────────────────────────────────────

const CONFIG_PATH = process.env.CONFIG_PATH || "/app/config.toml";
const PROXY_PORT = parseInt(process.env.PROXY_PORT || "7000", 10);
const API_PORT = parseInt(process.env.PROXY_API_PORT || "7001", 10);

let config = {};

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    config = parseToml(raw);
    console.log(`[proxy-manager] config loaded from ${CONFIG_PATH}`);
  } catch (err) {
    console.warn(`[proxy-manager] config load failed (${err.message}), using defaults`);
    config = getDefaultConfig();
  }
}

function getDefaultConfig() {
  return {
    server: { bindAddr: "0.0.0.0", bindPort: 7000 },
    health: { path: "/health", intervalSeconds: 30, timeoutSeconds: 5 },
    gateway: { apiPort: 8787, healthPath: "/health", corsOrigins: ["*"] },
    auth: { apiKey: "", token: "" },
    proxies: [],
  };
}

// Minimal TOML parser (handles the subset used in config.toml)
function parseToml(raw) {
  const out = { proxies: [] };
  let section = null;
  let currentProxy = null;

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Section headers
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      if (section === "server" || section === "health" || section === "gateway" || section === "auth") {
        out[section] = out[section] || {};
      }
      if (section === "proxies") {
        currentProxy = {};
        out.proxies.push(currentProxy);
      }
      continue;
    }

    // Key-value pairs
    const kvMatch = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      let value = kvMatch[2].trim();
      // Strip quotes, resolve env vars
      value = value.replace(/^["']|["']$/g, "");
      value = value.replace(/\$\{(\w+):-\}/g, (_, env) => process.env[env] || "");
      value = value.replace(/\$\{(\w+)\}/g, (_, env) => process.env[env] || "");

      // Parse typed values
      if (value === "true" || value === "false") value = value === "true";
      else if (/^\d+$/.test(value)) value = parseInt(value, 10);

      if (currentProxy && section === "proxies") {
        currentProxy[key] = value;
      } else if (section) {
        out[section][key] = value;
      } else {
        out[key] = value;
      }
    }
  }

  return out;
}

// ── Proxy tunnel state ──────────────────────────────────────────────────────

const tunnels = new Map(); // id → { id, name, type, localHost, localPort, remotePort, status, startedAt, bytesIn, bytesOut, conns }
let nextTunnelId = 1;

const events = new EventEmitter();

function createTunnel(def) {
  const tunnel = {
    id: nextTunnelId++,
    name: def.name || `tunnel-${nextTunnelId}`,
    type: def.type || "tcp",
    localHost: def.localIP || "127.0.0.1",
    localPort: def.localPort || 0,
    remotePort: def.remotePort || 0,
    status: "stopped",
    startedAt: null,
    bytesIn: 0,
    bytesOut: 0,
    conns: 0,
    server: null,
  };

  tunnels.set(tunnel.id, tunnel);
  return tunnel;
}

function startTunnel(tunnel) {
  if (tunnel.status === "running") return { ok: false, error: "already running" };

  try {
    if (tunnel.type === "tcp") {
      tunnel.server = net.createServer((clientSocket) => {
        tunnel.conns++;
        const backendSocket = net.createConnection({ host: tunnel.localHost, port: tunnel.localPort }, () => {
          clientSocket.pipe(backendSocket);
          backendSocket.pipe(clientSocket);
        });

        clientSocket.on("data", (chunk) => (tunnel.bytesIn += chunk.length));
        backendSocket.on("data", (chunk) => (tunnel.bytesOut += chunk.length));

        backendSocket.on("error", () => {
          clientSocket.destroy();
        });
        clientSocket.on("error", () => {
          backendSocket.destroy();
        });
        clientSocket.on("close", () => {
          if (tunnel.conns > 0) tunnel.conns--;
        });
      });

      tunnel.server.listen(tunnel.remotePort, config.server?.bindAddr || "0.0.0.0", () => {
        tunnel.status = "running";
        tunnel.startedAt = Date.now();
        console.log(`[proxy-manager] tunnel "${tunnel.name}" started — tcp:${tunnel.remotePort} → ${tunnel.localHost}:${tunnel.localPort}`);
        events.emit("tunnel:started", tunnel);
      });

      tunnel.server.on("error", (err) => {
        tunnel.status = "error";
        console.error(`[proxy-manager] tunnel "${tunnel.name}" error: ${err.message}`);
      });
    } else if (tunnel.type === "http") {
      tunnel.server = http.createServer((req, res) => {
        tunnel.conns++;
        const options = {
          hostname: tunnel.localHost,
          port: tunnel.localPort,
          path: req.url,
          method: req.method,
          headers: { ...req.headers, host: `${tunnel.localHost}:${tunnel.localPort}` },
        };

        const proxyReq = http.request(options, (proxyRes) => {
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          proxyRes.pipe(res);
          proxyRes.on("data", (chunk) => (tunnel.bytesOut += chunk.length));
        });

        req.on("data", (chunk) => (tunnel.bytesIn += chunk.length));
        req.pipe(proxyReq);

        proxyReq.on("error", () => {
          res.writeHead(502);
          res.end("Bad Gateway");
        });
        req.on("close", () => {
          if (tunnel.conns > 0) tunnel.conns--;
        });
      });

      tunnel.server.listen(tunnel.remotePort, config.server?.bindAddr || "0.0.0.0", () => {
        tunnel.status = "running";
        tunnel.startedAt = Date.now();
        console.log(`[proxy-manager] tunnel "${tunnel.name}" started — http:${tunnel.remotePort} → ${tunnel.localHost}:${tunnel.localPort}`);
        events.emit("tunnel:started", tunnel);
      });
    }

    return { ok: true };
  } catch (err) {
    tunnel.status = "error";
    return { ok: false, error: err.message };
  }
}

function stopTunnel(tunnel) {
  if (tunnel.server) {
    tunnel.server.close();
    tunnel.server = null;
  }
  tunnel.status = "stopped";
  tunnel.startedAt = null;
  events.emit("tunnel:stopped", tunnel);
  return { ok: true };
}

function getTunnelStats(tunnel) {
  const uptime = tunnel.startedAt ? Math.round((Date.now() - tunnel.startedAt) / 1000) : 0;
  return {
    id: tunnel.id,
    name: tunnel.name,
    type: tunnel.type,
    remotePort: tunnel.remotePort,
    localHost: tunnel.localHost,
    localPort: tunnel.localPort,
    status: tunnel.status,
    uptime,
    bytesIn: tunnel.bytesIn,
    bytesOut: tunnel.bytesOut,
    activeConns: tunnel.conns,
  };
}

// ── Proxy API server (internal, for gateway queries) ─────────────────────────

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try { resolve(JSON.parse(data)); } catch { resolve(null); }
    });
  });
}

const apiServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${API_PORT}`);
  const method = req.method.toUpperCase();

  // GET /api/proxy/tunnels — list all tunnels with stats
  if (url.pathname === "/api/proxy/tunnels" && method === "GET") {
    const list = [];
    for (const t of tunnels.values()) list.push(getTunnelStats(t));
    return json(res, 200, { success: true, data: list, count: list.length });
  }

  // POST /api/proxy/tunnels — create a new tunnel
  if (url.pathname === "/api/proxy/tunnels" && method === "POST") {
    const body = await readBody(req);
    if (!body?.localPort) return json(res, 400, { success: false, error: "localPort is required" });
    const tunnel = createTunnel(body);
    if (body.autoStart !== false) {
      const result = startTunnel(tunnel);
      if (!result.ok) {
        tunnels.delete(tunnel.id);
        return json(res, 500, { success: false, error: result.error });
      }
    }
    return json(res, 201, { success: true, data: getTunnelStats(tunnel) });
  }

  // GET /api/proxy/tunnels/:id — single tunnel status
  const tunnelIdMatch = url.pathname.match(/^\/api\/proxy\/tunnels\/(\d+)$/);
  if (tunnelIdMatch && method === "GET") {
    const id = parseInt(tunnelIdMatch[1], 10);
    const tunnel = tunnels.get(id);
    if (!tunnel) return json(res, 404, { success: false, error: "tunnel not found" });
    return json(res, 200, { success: true, data: getTunnelStats(tunnel) });
  }

  // POST /api/proxy/tunnels/:id/start — start a tunnel
  const startMatch = url.pathname.match(/^\/api\/proxy\/tunnels\/(\d+)\/start$/);
  if (startMatch && method === "POST") {
    const id = parseInt(startMatch[1], 10);
    const tunnel = tunnels.get(id);
    if (!tunnel) return json(res, 404, { success: false, error: "tunnel not found" });
    const result = startTunnel(tunnel);
    return json(res, result.ok ? 200 : 400, result);
  }

  // POST /api/proxy/tunnels/:id/stop — stop a tunnel
  const stopMatch = url.pathname.match(/^\/api\/proxy\/tunnels\/(\d+)\/stop$/);
  if (stopMatch && method === "POST") {
    const id = parseInt(stopMatch[1], 10);
    const tunnel = tunnels.get(id);
    if (!tunnel) return json(res, 404, { success: false, error: "tunnel not found" });
    const result = stopTunnel(tunnel);
    return json(res, 200, result);
  }

  // DELETE /api/proxy/tunnels/:id — remove a tunnel
  if (tunnelIdMatch && method === "DELETE") {
    const id = parseInt(tunnelIdMatch[1], 10);
    const tunnel = tunnels.get(id);
    if (!tunnel) return json(res, 404, { success: false, error: "tunnel not found" });
    stopTunnel(tunnel);
    tunnels.delete(id);
    return json(res, 200, { success: true, data: null });
  }

  // GET /api/proxy/status — overall proxy health
  if (url.pathname === "/api/proxy/status" && method === "GET") {
    const running = [...tunnels.values()].filter((t) => t.status === "running").length;
    const total = tunnels.size;
    const totalBytes = [...tunnels.values()].reduce((s, t) => s + t.bytesIn + t.bytesOut, 0);
    const totalConns = [...tunnels.values()].reduce((s, t) => s + t.conns, 0);
    return json(res, 200, {
      success: true,
      data: {
        status: "ok",
        tunnelCount: total,
        tunnelsRunning: running,
        tunnelsStopped: total - running,
        totalBytesTransferred: totalBytes,
        totalActiveConns: totalConns,
        config: {
          bindAddr: config.server?.bindAddr || "0.0.0.0",
          bindPort: config.server?.bindPort || PROXY_PORT,
        },
      },
    });
  }

  // GET /health — health check
  if ((url.pathname === "/health" || url.pathname === "/") && method === "GET") {
    return json(res, 200, { status: "ok", uptime: Math.round((Date.now() - startedAt) / 1000) });
  }

  json(res, 404, { success: false, error: "not found" });
});

// ── Main proxy server (TCP/HTTP multiplexer) ─────────────────────────────────

const mainServer = net.createServer((socket) => {
  // Peek detection: check if this is HTTP traffic
  let firstChunk = true;
  socket.on("data", (chunk) => {
    if (firstChunk) {
      firstChunk = false;
      const str = chunk.toString("utf-8", 0, Math.min(chunk.length, 16));
      // If it looks like HTTP, let the API server handle it
      if (/^(GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH) /.test(str)) {
        apiServer.emit("connection", socket);
        socket.unshift(chunk); // Re-queue for the HTTP parser
        return;
      }
    }
    // Forward to a matching tunnel based on destination port
    // (tunnel matching happens via the tunnel servers themselves)
    socket.destroy();
  });
});

// ── Startup ──────────────────────────────────────────────────────────────────

const startedAt = Date.now();

function start() {
  loadConfig();

  // Start the API server
  apiServer.listen(API_PORT, "127.0.0.1", () => {
    console.log(`[proxy-manager] API server listening on http://127.0.0.1:${API_PORT}`);
    console.log(`[proxy-manager] auth: ${config.auth?.apiKey ? "configured" : "open"}`);
  });

  // Start the main proxy server for TCP/UDP forwarding
  const bindAddr = config.server?.bindAddr || "0.0.0.0";
  const bindPort = config.server?.bindPort || PROXY_PORT;

  mainServer.listen(bindPort, bindAddr, () => {
    console.log(`[proxy-manager] proxy server listening on ${bindAddr}:${bindPort}`);
  });

  // Auto-start tunnels from config
  if (Array.isArray(config.proxies)) {
    for (const proxyDef of config.proxies) {
      if (!proxyDef.name || !proxyDef.localPort) continue;
      const tunnel = createTunnel(proxyDef);
      if (proxyDef.autoStart !== false) {
        startTunnel(tunnel);
      }
    }
  }

  // Periodic stats dump
  setInterval(() => {
    const running = [...tunnels.values()].filter((t) => t.status === "running").length;
    if (running > 0) {
      console.log(`[proxy-manager] stats: ${running}/${tunnels.size} tunnels running`);
    }
  }, 60000);
}

start();
