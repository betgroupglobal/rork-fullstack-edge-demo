# PhishletConstructor Agent

A standalone Puppeteer-based agent that navigates a target login page, extracts the login form, builds a deterministic YAML phishlet configuration, and performs a lightweight validation pass by submitting synthetic credentials.

## ⚠️ Authorization Required

This tool is intended for **authorized security testing and research only**. You must either:

- Pass `--authorized` on the command line, or
- Add the target hostname to the `ALLOWED_TARGETS` environment variable.

The script will refuse to run against unauthorized targets.

## Install

```bash
cd agents
npm install
```

## Usage

### Standalone (local YAML output)

```bash
# Explicit authorization flag
npx tsx phishlet-constructor.ts --target-url https://example.com/login --authorized

# Or via environment variable
ALLOWED_TARGETS=example.com npx tsx phishlet-constructor.ts --target-url https://example.com/login
```

### Integrated with the app gateway

The agent can upload the generated YAML directly to a proxy in the gateway app. Use the command generated in the mobile/web app under **Recon → Headless Agent**, or build it manually:

```bash
GATEWAY_BASE_URL=https://your-gateway.example.com \
GATEWAY_API_KEY=your-api-key \
PROXY_ID=123 \
npx tsx phishlet-constructor.ts --target-url https://example.com/login --authorized
```

The agent will still save the YAML locally to `./phishlets/{hostname}.yaml` and, when the gateway env vars are set, POST the captured form to the gateway's `/api/proxies/{PROXY_ID}/login-phishlet` endpoint. The gateway only saves the YAML if the agent's validation score is >= 0.7.

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `ALLOWED_TARGETS` | Comma-separated authorized hostnames | *(none)* |
| `PROXY_IP` | Optional proxy IP to embed in the generated YAML | *(none)* |
| `OUTPUT_DIR` | Directory to write generated YAML | `./phishlets` |
| `PUPPETEER_HEADLESS` | Run browser headless | `true` |
| `VALIDATION_PASSWORD` | Password used for the synthetic login test | `Test1234!` |
| `GATEWAY_BASE_URL` | Optional gateway API base URL for uploading results | *(none)* |
| `GATEWAY_API_KEY` | Optional API key for the gateway | *(none)* |
| `PROXY_ID` | Optional proxy ID on the gateway to associate with the result | *(none)* |

## Output

On successful validation (score >= 0.7), the YAML is written to:

```
./phishlets/{hostname}.yaml
```

If validation fails, the YAML is printed to stderr but not saved.
