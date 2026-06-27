/**
 * AI-Powered Phishlet Constructor & Verifier
 *
 * Uses Kimi K2.7 Code High Speed (via Rork Toolkit proxy) to construct and
 * verify Evilginx2-compatible phishlet YAML configurations without Puppeteer.
 *
 * Modes:
 *   construct — generates a YAML phishlet from a target URL (optionally with captured form data)
 *   verify    — critiques and improves an existing phishlet YAML
 *
 * Prerequisites:
 *   TOOLKIT_URL        — Rork Toolkit base URL (e.g. https://toolkit.rork.app)
 *   TOOLKIT_SECRET_KEY — Rork Toolkit secret key
 *
 * Usage:
 *   npx tsx agents/ai-phishlet.ts construct --target-url https://example.com/login --authorized
 *   npx tsx agents/ai-phishlet.ts verify   --phishlet ./phishlets/example.com.yaml
 *   npx tsx agents/ai-phishlet.ts construct --target-url https://example.com/login \
 *     --captured ./captured.json --authorized --output ./phishlets/result.yaml
 *
 * IMPORTANT: Only run against targets you own or have explicit written authorization.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import https from "node:https";
import http from "node:http";

const usage = `
AI Phishlet Constructor & Verifier (Kimi K2.7 Code High Speed)

Usage:
  npx tsx agents/ai-phishlet.ts <mode> [options]

Modes:
  construct   Generate a YAML phishlet from a target URL
  verify      Critique and improve an existing phishlet

Required options:
  --target-url <url>       Target login page URL (construct mode)
  --phishlet <path|yaml>   Path to YAML file or inline YAML string (verify mode)
  --authorized             Required authorization flag

Optional options:
  --captured <path>        JSON file with captured form intelligence
  --proxy-name <name>      Custom proxy name (defaults to hostname)
  --output <path>          Write result YAML to file (default: stdout)
  --hostname <hostname>    Override hostname extracted from URL

Environment:
  TOOLKIT_URL              Rork Toolkit base URL (required)
  TOOLKIT_SECRET_KEY       Rork Toolkit secret key (required)
`;

type Mode = "construct" | "verify";

type PhishletAIInput = {
  mode: Mode;
  targetUrl?: string;
  hostname: string;
  proxyName: string;
  phishlet?: string;
  captured?: Record<string, unknown>;
};

type PhishletAIResult = {
  phishlet: string;
  passes: number;
  score: number;
  critiques: Array<{ pass: number; finding: string; severity: string; fix: string }>;
  improvements: string[];
};

function die(message: string): never {
  console.error(`\nError: ${message}\n${usage}`);
  process.exit(1);
}

function parseArgs(): {
  mode: Mode;
  targetUrl?: string;
  phishlet?: string;
  captured?: Record<string, unknown>;
  proxyName?: string;
  hostname?: string;
  outputPath?: string;
  authorized: boolean;
} {
  const args = process.argv.slice(2);
  const mode = args[0] as Mode | undefined;
  if (mode !== "construct" && mode !== "verify") {
    die("First argument must be 'construct' or 'verify'.");
  }

  const getArg = (flag: string) => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : undefined;
  };

  const hasFlag = (flag: string) => args.includes(flag);

  const targetUrl = getArg("--target-url");
  let phishlet = getArg("--phishlet");
  const capturedPath = getArg("--captured");
  const proxyName = getArg("--proxy-name");
  let hostname = getArg("--hostname");
  const outputPath = getArg("--output");
  const authorized = hasFlag("--authorized");

  if (mode === "construct" && !targetUrl) {
    die("--target-url is required in construct mode.");
  }
  if (mode === "verify" && !phishlet) {
    die("--phishlet is required in verify mode.");
  }
  if (!authorized) {
    die("--authorized flag is required. Only test targets you own or have explicit written authorization for.");
  }

  // Validate target URL
  if (targetUrl) {
    try {
      const u = new URL(targetUrl);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        die("URL must use http or https.");
      }
      if (!hostname) hostname = u.hostname;
    } catch {
      die(`Invalid URL: ${targetUrl}`);
    }
  }

  // If phishlet is a file path, read it
  if (phishlet && fs.existsSync(phishlet)) {
    phishlet = fs.readFileSync(phishlet, "utf-8").trim();
  }

  // Read captured JSON if provided
  let captured: Record<string, unknown> | undefined;
  if (capturedPath && fs.existsSync(capturedPath)) {
    try {
      captured = JSON.parse(fs.readFileSync(capturedPath, "utf-8"));
    } catch {
      die(`Invalid JSON in captured file: ${capturedPath}`);
    }
  }

  if (mode === "construct" && !hostname && targetUrl) {
    hostname = new URL(targetUrl).hostname;
  }
  if (mode === "verify" && !hostname) {
    hostname = "unknown";
  }

  return {
    mode,
    targetUrl,
    phishlet: phishlet || undefined,
    captured,
    proxyName: proxyName || hostname || "phishlet",
    hostname,
    outputPath,
    authorized,
  };
}

// ── Kimi K2.7 AI call ───────────────────────────────────────────────────────

function httpPost(url: URL, body: string, secretKey: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const options = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${secretKey}`,
        "Content-Length": Buffer.byteLength(body),
      },
      timeout: 60000,
    };

    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(url, options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data) as Record<string, unknown>);
        } catch {
          reject(new Error(`Invalid JSON response: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out after 60s"));
    });

    req.write(body);
    req.end();
  });
}

function buildSystemPrompt(): string {
  return [
    "You are an expert security researcher building Evilginx2-compatible phishlet YAML configurations.",
    "You only test targets you own or have explicit written authorization to test.",
    "A phishlet is a YAML file that defines how to proxy a login page, capture credentials, and extract session tokens.",
    "",
    "## YAML format required:",
    "```yaml",
    'name: "<proxy_name>"',
    "proxy:",
    '  - domain: "<hostname>"',
    "    ssl: true",
    "    is_landing: true",
    "login:",
    '  path: "<login_path>"',
    '  submit: "<css_selector_for_form>"',
    "  inputs:",
    '    username: "<input_name_or_id>"',
    '    password: "<input_name_or_id>"',
    "    # hidden inputs listed below",
    "credentials:",
    "  username:",
    '    key: "<input_name_or_id>"',
    "  password:",
    '    key: "<input_name_or_id>"',
    "session:",
    "  tokens:",
    '    - name: "<token_name>"',
    '      key: "Set-Cookie"',
    '      search: "<regex_or_substring>"',
    "```",
    "",
    "## Rules:",
    "- Use double-quoted strings for all YAML values.",
    "- Escape double quotes inside values with backslash.",
    "- The submit selector must be a valid CSS selector for the login form.",
    "- Hidden inputs must be listed under login.inputs with their values.",
    "- CSRF tokens in hidden inputs should be preserved as-is.",
    "- Session tokens should match common auth cookie names.",
    "- When multiple password fields exist, select the most likely one (not confirm-password).",
    "- Output ONLY the YAML. No explanations, no markdown fences, no commentary.",
  ].join("\n");
}

function buildConstructPrompt(input: PhishletAIInput): string {
  const parts = [
    `Construct a phishlet YAML for: ${input.targetUrl}`,
    `Target hostname: ${input.hostname}`,
    `Proxy name: ${input.proxyName}`,
  ];

  if (input.captured) {
    parts.push("\n## Captured intelligence from the target page:");
    parts.push(JSON.stringify(input.captured, null, 2));
  } else {
    parts.push("\nNo captured data provided. Use your knowledge of common login page patterns.");
    parts.push(`For ${input.hostname}, infer the likely login path, form structure, field names, and session token cookies.`);
  }

  parts.push("\nOutput ONLY the YAML.");
  return parts.join("\n");
}

function buildVerifyPrompt(input: PhishletAIInput): string {
  const parts = [
    `Critique and improve this phishlet YAML for target: ${input.hostname}`,
    "",
    "## Current phishlet:",
    "```yaml",
    input.phishlet || "",
    "```",
    "",
  ];

  if (input.captured) {
    parts.push("## Captured intelligence (use to verify selectors and fields):");
    parts.push(JSON.stringify(input.captured, null, 2));
  }

  parts.push(
    "## Instructions:",
    "1. Audit the phishlet for correctness — check selectors, field names, session token patterns, hidden inputs, CSRF handling.",
    "2. Fix any issues you find.",
    "3. Output your response in this exact JSON format:",
    "```json",
    "{",
    '  "phishlet": "<improved YAML with double quotes properly escaped>",',
    '  "score": <0-100>,',
    '  "passes": 2,',
    '  "critiques": [',
    '    { "pass": 1, "finding": "...", "severity": "critical|warning|info", "fix": "..." }',
    "  ],",
    '  "improvements": ["..."]',
    "}",
    "```",
    "Output ONLY valid JSON — no markdown fences, no commentary.",
  );

  return parts.join("\n");
}

function parseVerifyResponse(rawContent: string, fallbackPhishlet: string): PhishletAIResult | null {
  try {
    const parsed = JSON.parse(rawContent);
    if (parsed.phishlet && typeof parsed.phishlet === "string") {
      return {
        phishlet: parsed.phishlet,
        passes: parsed.passes || 2,
        score: typeof parsed.score === "number" ? parsed.score : 75,
        critiques: Array.isArray(parsed.critiques) ? parsed.critiques : [],
        improvements: Array.isArray(parsed.improvements) ? parsed.improvements : [],
      };
    }
  } catch {
    // JSON parse failed — treat as raw YAML
    if (rawContent.includes("name:") && rawContent.includes("proxy:")) {
      return {
        phishlet: rawContent,
        passes: 2,
        score: 65,
        critiques: [
          { pass: 1, finding: "AI provided a refined phishlet (non-JSON response)", severity: "info", fix: "Manual review recommended" },
        ],
        improvements: ["AI refinement applied"],
      };
    }
  }
  return null;
}

async function callKimiAI(input: PhishletAIInput, toolkitUrl: string, secretKey: string): Promise<PhishletAIResult | null> {
  const systemPrompt = buildSystemPrompt();
  const userPrompt = input.mode === "construct"
    ? buildConstructPrompt(input)
    : buildVerifyPrompt(input);

  const body = JSON.stringify({
    model: "moonshotai/kimi-k2.7-code-highspeed",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_tokens: 4096,
    temperature: 0.2,
  });

  const url = new URL("/v2/vercel/v1/chat/completions", toolkitUrl);
  const result = await httpPost(url, body, secretKey);

  const choices = result?.choices as Array<{ message?: { content?: string } }> | undefined;
  if (!choices?.[0]?.message?.content) {
    console.error("[kimi] empty or invalid response");
    return null;
  }

  let rawContent = choices[0].message.content.trim();
  // Strip markdown fences
  rawContent = rawContent.replace(/^```(?:yaml|json)\s*\n?/i, "").replace(/\n?```\s*$/, "").trim();

  if (input.mode === "verify") {
    return parseVerifyResponse(rawContent, input.phishlet || "");
  }

  return { phishlet: rawContent, passes: 1, score: 80, critiques: [], improvements: [] };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const toolkitUrl = process.env.TOOLKIT_URL?.replace(/\/$/, "");
  const secretKey = process.env.TOOLKIT_SECRET_KEY;

  if (!toolkitUrl || !secretKey) {
    die("TOOLKIT_URL and TOOLKIT_SECRET_KEY environment variables are required.");
  }

  const args = parseArgs();

  const input: PhishletAIInput = {
    mode: args.mode,
    targetUrl: args.targetUrl,
    hostname: args.hostname!,
    proxyName: args.proxyName!,
    phishlet: args.phishlet,
    captured: args.captured,
  };

  console.log(`[kimi] Calling Kimi K2.7 Code High Speed for ${args.mode}...`);
  console.log(`[kimi] Target: ${input.hostname}`);

  const startTime = Date.now();
  const result = await callKimiAI(input, toolkitUrl, secretKey);
  const elapsed = Date.now() - startTime;

  if (!result) {
    die("AI call returned no usable result.");
  }

  console.log(`[kimi] Completed in ${elapsed}ms`);
  console.log(`[kimi] Score: ${result.score}/100 (${result.passes} pass${result.passes !== 1 ? "es" : ""})`);

  if (result.critiques.length > 0) {
    console.log(`\n[CRITIQUES] ${result.critiques.length} finding${result.critiques.length !== 1 ? "s" : ""}:`);
    for (const c of result.critiques) {
      console.log(`  [${c.severity.toUpperCase()}] ${c.finding}`);
      console.log(`    → Fix: ${c.fix}`);
    }
  }

  if (result.improvements.length > 0) {
    console.log(`\n[IMPROVEMENTS]`);
    for (const imp of result.improvements) {
      console.log(`  - ${imp}`);
    }
  }

  console.log(`\n[YAML]`);
  console.log(result.phishlet);

  // Save to file if requested
  if (args.outputPath) {
    fs.mkdirSync(path.dirname(args.outputPath), { recursive: true });
    fs.writeFileSync(args.outputPath, result.phishlet);
    console.log(`\n[OUTPUT] YAML saved to ${args.outputPath}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(`\nFatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
