# flow-mcp

A safer alternative to running `flow2api` server-side: a **Chrome extension + local MCP bridge** that lets any MCP-compatible AI agent (Claude Desktop, Cursor, Cline, Continue, ...) drive Google Labs **Flow** (Veo / Imagen / Gemini image) **using the user's own logged-in browser session**.

## Why

`flow2api` is fantastic, but to make it work headless it has to:

- store/refresh `__Secure-next-auth.session-token` server-side,
- solve / forward reCAPTCHA via third-party services or a hidden Playwright browser,
- spoof Chromium client hints (`x-browser-validation`, `sec-ch-ua-*`, ...) and TLS fingerprint via `curl_cffi`.

This project does none of that. The extension runs **inside your real Chrome**, and every Flow request:

- carries your real cookies (Chrome attaches them automatically with `credentials: "include"`),
- uses the **page's own `grecaptcha.enterprise.execute()`** to obtain a legitimate reCAPTCHA token,
- ships with no third-party captcha solvers, no UA spoofing, no proxy.

The local bridge is a **stdio MCP server** that an AI agent spawns; it forwards JSON-RPC-ish ops to the extension over `ws://127.0.0.1`.

```
┌─────────────────┐  stdio MCP    ┌────────────────────┐
│ AI agent A      │ ◀───────────▶ │ flow-mcp-bridge A  │ ┐
└─────────────────┘               └────────────────────┘ │
┌─────────────────┐  stdio MCP    ┌────────────────────┐ │  ws://127.0.0.1
│ AI agent B      │ ◀───────────▶ │ flow-mcp-bridge B  │ ┼────────────────┐
└─────────────────┘               └────────────────────┘ │                │
┌─────────────────┐  stdio MCP    ┌────────────────────┐ │                ▼
│ AI agent C      │ ◀───────────▶ │ flow-mcp-bridge C  │ ┘   ┌────────────────────────────┐
└─────────────────┘               └────────────────────┘     │ flow-mcp Native Host       │
                                                             │ (spawned by Chrome via NM) │
                                                             └────────────┬───────────────┘
                                                                          │ stdio NM
                                                                          ▼
                                                             ┌──────────────────────────┐
                                                             │ Chrome extension         │
                                                             │  - cookies + recaptcha   │
                                                             │  - fetch labs.google     │
                                                             └──────────────────────────┘
                                                                          │
                                                                          ▼
                                                             labs.google / aisandbox-pa
```

Multiple MCP clients can run concurrently — each spawns its own thin
`flow-mcp-bridge` (a WebSocket client). They all multiplex through the single
Native Messaging host process that Chrome auto-spawns for the extension.

## Install

### 1. Build the bridge

```powershell
cd flow-mcp\bridge
npm install
npm run build
```

This produces `dist/index.js`. The bridge is now a thin WS **client**; the
WebSocket server is owned by the Native Messaging host (next step).

### 2. Install the Native Messaging host

```powershell
cd flow-mcp\native-host
npm install
```

You will register it with Chrome **after** loading the extension (we need the
extension ID for the manifest).

### 3. Load the extension in Chrome

1. Open `chrome://extensions`, enable **Developer mode**.
2. Click **Load unpacked**, pick the `flow-mcp/extension` folder.
3. Copy the extension ID shown on the card (e.g. `abcdefghijklmnop...`).
4. Open https://labs.google/ and sign in normally.

### 4. Register the Native Messaging host with Chrome

Pass the extension ID from step 3:

**Windows (PowerShell):**
```powershell
cd flow-mcp\native-host
powershell -ExecutionPolicy Bypass -File .\install.ps1 -ExtensionId <EXT_ID>
```

**macOS / Linux:**
```bash
cd flow-mcp/native-host
./install.sh <EXT_ID>
```

The script writes the manifest, a launcher, and (on Windows) a registry entry
under `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.flow_mcp.host`.

Reload the extension on `chrome://extensions`. The popup should turn green and
read `connected (native host ready (ws://127.0.0.1:39999))`. The native host
writes a handshake at `~/.flow-mcp-bridge.json` containing the actual host/port
in case the default port was busy and a fallback was used.

### 5. Wire it into your agent(s)

#### Claude Desktop (`claude_desktop_config.json`)

```jsonc
{
  "mcpServers": {
    "flow": {
      "command": "node",
      "args": ["D:/Dev/flow2api/flow-mcp/bridge/dist/index.js"]
    }
  }
}
```

#### Cursor (`~/.cursor/mcp.json`) / Cline / Continue: same shape.

You can wire **multiple agents at once** — each will spawn its own bridge
process; they all share the single extension session through the native host.

Restart the agent. You should see the `flow_*` tools become available.

## Tools exposed

| Tool | Purpose |
|---|---|
| `flow_list_models` | List image + video models known to the bridge (mirrors `MODEL_CONFIG`) |
| `flow_get_credits` | VideoFX credits and tier |
| `flow_list_projects` / `flow_create_project` / `flow_delete_project` | Project CRUD (uses `__Secure-next-auth.session-token` cookie via the extension) |
| `flow_upload_image` | Upload a base64 image, returns `mediaId` |
| `flow_generate_image` | Text-to-image / image-to-image, supports 2K/4K upsample chains |
| `flow_generate_video` | T2V / I2V (start, start+end) / R2V — model picks the variant automatically |
| `flow_poll_video` | One-shot status poll |
| `flow_wait_video` | Block (with progress notifications) until generation completes |

Model ids (e.g. `gemini-3.1-flash-image-landscape`, `veo_3_1_t2v_fast_landscape`, `veo_3_1_r2v_fast`) are identical to the keys in `flow2api`'s `MODEL_CONFIG`, so any prompt/test you have for `flow2api` works as-is.

## Safety / scope

- WebSocket server binds **`127.0.0.1`** only.
- All API calls run as **the logged-in user** — credits/quotas are charged to **their** account; rate-limits are theirs.
- No reCAPTCHA bypass, no client-hint spoofing, no third-party solver, no shared accounts.

## Limitations

- Requires Chrome to be running and signed into labs.google whenever the agent invokes a tool.
- The reCAPTCHA sitekey is auto-discovered from the project page; if Google ships a UI change, the discovery in `extension/flow_api.js` (`getRecaptchaToken`) may need a small tweak.
