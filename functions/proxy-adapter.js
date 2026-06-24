/**
 * Local HTTP proxy adapter for standard HTTP CONNECT proxies (e.g. Bright Data).
 *
 * The gateway runs in a Workers-compatible runtime (workerd via wrangler dev) which
 * cannot speak standard HTTP CONNECT itself. This adapter sits on localhost and
 * exposes a URL-rewriting interface: `/?url=<target>`. The gateway's
 * RESIDENTIAL_PROXY_POOL can point to this adapter, and the adapter forwards the
 * request through the configured upstream proxy.
 */

import http from "http";
import fetch from "node-fetch";
import { HttpsProxyAgent } from "https-proxy-agent";

const ADAPTER_PORT = Number(process.env.PORT_PROXY ?? "33336");
const UPSTREAM_PROXY = process.env.BRIGHTDATA_PROXY_URL ?? process.env.RESIDENTIAL_PROXY_POOL ?? "";

if (!UPSTREAM_PROXY) {
  console.error("[proxy-adapter] Missing BRIGHTDATA_PROXY_URL / RESIDENTIAL_PROXY_POOL");
  process.exit(1);
}

const agent = new HttpsProxyAgent(UPSTREAM_PROXY);

const server = http.createServer((req, res) => {
  const reqUrl = new URL(req.url, `http://localhost:${ADAPTER_PORT}`);
  const targetUrl = reqUrl.searchParams.get("url");
  if (!targetUrl) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "missing url query param" }));
    return;
  }

  const headers = { ...req.headers };
  delete headers.host;
  delete headers.connection;
  delete headers["proxy-authorization"];

  const body = req.method !== "GET" && req.method !== "HEAD" ? req : undefined;

  fetch(targetUrl, {
    method: req.method,
    headers,
    body,
    agent,
    redirect: "manual",
  })
    .then((upstream) => {
      res.statusCode = upstream.status;
      for (const [key, value] of upstream.headers) {
        res.setHeader(key, value);
      }
      upstream.body.pipe(res);
    })
    .catch((err) => {
      console.error("[proxy-adapter] fetch error", err.message);
      res.statusCode = 502;
      res.end(JSON.stringify({ error: "proxy adapter error", message: err.message }));
    });
});

server.listen(ADAPTER_PORT, "127.0.0.1", () => {
  console.log(`[proxy-adapter] listening on http://127.0.0.1:${ADAPTER_PORT} -> ${UPSTREAM_PROXY.replace(/:[^:]*@/, ":***@")}`);
});
