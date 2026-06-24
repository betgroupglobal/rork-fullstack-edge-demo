/**
 * Local authentication server backed by Railway PostgreSQL.
 *
 * The gateway runs in a Workers-compatible runtime that cannot speak Postgres
 * directly. This adapter runs inside the same Railway container and exposes
 * the same /api/auth endpoints that the worker used to serve from the Durable
 * Object. The worker forwards /api/auth/* requests here.
 */

import http from "http";
import crypto from "crypto";
import { Pool } from "pg";

const AUTH_PORT = Number(process.env.PORT_AUTH ?? "33337");
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("[auth-server] Missing DATABASE_URL");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      created_at BIGINT NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL
    )
  `);
}

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString("hex");
}

async function hashPassword(password, saltHex) {
  const salt = Buffer.from(saltHex, "hex");
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, 100000, 32, "sha256", (err, derivedKey) => {
      if (err) return reject(err);
      resolve(derivedKey.toString("hex"));
    });
  });
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function json(status, payload) {
  return [
    status,
    {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
    JSON.stringify(payload),
  ];
}

async function handleSignup(body) {
  const email = (body.email ?? "").toString().trim().toLowerCase();
  const password = (body.password ?? "").toString();
  const name = (body.name ?? "").toString().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(400, { success: false, error: "Enter a valid email address." });
  }
  if (password.length < 8) {
    return json(400, { success: false, error: "Password must be at least 8 characters." });
  }
  const existing = await pool.query("SELECT 1 FROM users WHERE email = $1", [email]).catch(() => null);
  if (existing && existing.rowCount > 0) {
    return json(409, { success: false, error: "An account with that email already exists." });
  }
  const salt = randomHex(16);
  const hash = await hashPassword(password, salt);
  const now = Date.now();
  const inserted = await pool.query(
    "INSERT INTO users (email, name, password_hash, salt, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [email, name, hash, salt, now],
  );
  const userId = inserted.rows[0].id;
  return issueSession(userId, email, name);
}

async function handleLogin(body) {
  const email = (body.email ?? "").toString().trim().toLowerCase();
  const password = (body.password ?? "").toString();
  const result = await pool.query(
    "SELECT id, name, password_hash, salt FROM users WHERE email = $1",
    [email],
  );
  const row = result.rows[0];
  if (!row) {
    return json(401, { success: false, error: "Invalid email or password." });
  }
  const hash = await hashPassword(password, row.salt);
  if (!safeEqual(hash, row.password_hash)) {
    return json(401, { success: false, error: "Invalid email or password." });
  }
  return issueSession(row.id, email, row.name);
}

async function handleLogout(req) {
  const auth = req.headers["authorization"] ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token) {
    await pool.query("DELETE FROM sessions WHERE token = $1", [token]);
  }
  return json(200, { success: true });
}

async function handleMe(req) {
  const auth = req.headers["authorization"] ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) {
    return json(401, { success: false, error: "unauthorized" });
  }
  const now = Date.now();
  const result = await pool.query(
    `SELECT u.id, u.email, u.name
       FROM users u
       JOIN sessions s ON s.user_id = u.id
      WHERE s.token = $1 AND s.expires_at > $2`,
    [token, now],
  );
  const row = result.rows[0];
  if (!row) {
    return json(401, { success: false, error: "unauthorized" });
  }
  return json(200, { success: true, data: { user: row } });
}

async function issueSession(userId, email, name) {
  const token = randomHex(32);
  const now = Date.now();
  const expiresAt = now + 30 * 24 * 60 * 60 * 1000; // 30 days
  await pool.query(
    "DELETE FROM sessions WHERE expires_at < $1",
    [now],
  );
  await pool.query(
    "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)",
    [token, userId, now, expiresAt],
  );
  return json(200, { success: true, data: { token, user: { id: userId, email, name } } });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${AUTH_PORT}`);
  const path = url.pathname;
  let body = {};
  try {
    const text = await readBody(req);
    if (text) body = JSON.parse(text);
  } catch {
    return res.writeHead(...json(400, { success: false, error: "invalid json" })).end();
  }

  try {
    let status, headers, payload;
    if (path === "/api/auth/signup" && req.method === "POST") {
      [status, headers, payload] = await handleSignup(body);
    } else if (path === "/api/auth/login" && req.method === "POST") {
      [status, headers, payload] = await handleLogin(body);
    } else if (path === "/api/auth/logout" && req.method === "POST") {
      [status, headers, payload] = await handleLogout(req);
    } else if (path === "/api/auth/me" && req.method === "GET") {
      [status, headers, payload] = await handleMe(req);
    } else {
      [status, headers, payload] = json(404, { success: false, error: "not found" });
    }
    res.writeHead(status, headers);
    res.end(payload);
  } catch (err) {
    console.error("[auth-server] error", err.message);
    res.writeHead(...json(500, { success: false, error: "auth server error" }));
    res.end();
  }
});

await ensureTables();
server.listen(AUTH_PORT, "127.0.0.1", () => {
  console.log(`[auth-server] listening on http://127.0.0.1:${AUTH_PORT} with Railway Postgres`);
});
