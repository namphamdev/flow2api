# flow-mcp Setup Guide

End-to-end setup for `flow-mcp` — the Chrome / Edge extension + Native
Messaging host + MCP bridge that lets AI agents (Claude Desktop, Cursor,
Cline, Continue, ...) drive Google Labs Flow using your own logged-in
browser session.

> Multiple AI agents can run at the same time. Each one spawns its own thin
> `flow-mcp-bridge` process; all of them multiplex through a single Native
> Messaging host that the browser auto-spawns when the extension loads.

---

## 1. Prerequisites

| Tool | Min version | Notes |
|---|---|---|
| **Node.js** | 18+ (20 LTS recommended) | Used for the bridge and the native host |
| **npm** | bundled with Node | |
| **Chrome** or **Microsoft Edge** | 120+ | Both supported; Edge uses the same extension API |
| **Google account** with access to https://labs.google/ | — | The extension uses *your* cookies |

Verify Node is on PATH:
```powershell
node --version
npm  --version
```

---

## 2. Build the MCP bridge

The bridge is a thin stdio MCP server that AI agents spawn. It connects as a
WebSocket client to the native host.

```powershell
cd D:\Dev\flow2api\flow-mcp\bridge
npm install
npm run build
```

This produces `D:\Dev\flow2api\flow-mcp\bridge\dist\index.js`. Remember this
path — you'll plug it into agent configs in step 6.

---

## 3. Install Native Messaging host dependencies

The native host owns the WebSocket server on `127.0.0.1` and is launched by
the browser via Chrome Native Messaging.

```powershell
cd D:\Dev\flow2api\flow-mcp\native-host
npm install
```

You will register it with the browser **after** loading the extension
(step 5), because the manifest needs the extension's runtime ID.

---

## 4. Load the extension

### Chrome
1. Open `chrome://extensions`
2. Toggle **Developer mode** ON (top-right)
3. Click **Load unpacked**
4. Select the folder `D:\Dev\flow2api\flow-mcp\extension`
5. **Copy the extension ID** shown on the card (32-character lowercase string)

### Microsoft Edge
1. Open `edge://extensions`
2. Toggle **Developer mode** ON (bottom-left)
3. Click **Load unpacked**
4. Select the folder `D:\Dev\flow2api\flow-mcp\extension`
5. **Copy the extension ID** shown on the card

Then sign in to https://labs.google/ in the same browser profile.

---

## 5. Register the Native Messaging host with the browser

Use the extension ID from step 4.

### Windows (PowerShell)

**Chrome only:**
```powershell
cd D:\Dev\flow2api\flow-mcp\native-host
powershell -ExecutionPolicy Bypass -File .\install.ps1 -ExtensionId <EXT_ID>
```

**Edge only:**
```powershell
cd D:\Dev\flow2api\flow-mcp\native-host
powershell -ExecutionPolicy Bypass -File .\install.ps1 -ExtensionId <EXT_ID> -Browser Edge
```

**Both browsers (same extension ID, or run twice with different IDs):**
```powershell
cd D:\Dev\flow2api\flow-mcp\native-host
powershell -ExecutionPolicy Bypass -File .\install.ps1 -ExtensionId <EXT_ID> -Browser Both
```

If `node` is not on PATH, append `-NodePath "C:\Program Files\nodejs\node.exe"`.

### macOS / Linux
```bash
cd ~/path/to/flow2api/flow-mcp/native-host
./install.sh <EXT_ID>
```

### What the installer does
- Writes a launcher script (`flow-mcp-host.bat` on Windows, `flow-mcp-host.sh` on POSIX) that runs `node host.js`.
- Writes the NM manifest `com.flow_mcp.host.json` with `allowed_origins: ["chrome-extension://<EXT_ID>/"]`.
- Registers the manifest with the browser:
  - Chrome (Win): `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.flow_mcp.host`
  - Edge   (Win): `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.flow_mcp.host`
  - Chrome (macOS): `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`
  - Chrome (Linux): `~/.config/google-chrome/NativeMessagingHosts/`

After registering, **reload the extension** on the extensions page (click the
circular arrow on the extension card).

---

## 6. Verify the connection

1. Click the Flow MCP Bridge icon in the browser toolbar.
2. Status should turn **green** and show something like:
   ```
   connected (native host ready (ws://127.0.0.1:39999))
   ```
3. The native host writes a handshake file at `~/.flow-mcp-bridge.json`
   (i.e. `C:\Users\<you>\.flow-mcp-bridge.json` on Windows) containing the
   actual host and port. Bridges read this file to find the host.

If status is red, see [Troubleshooting](#troubleshooting) below.

---

## 7. Wire MCP clients

The bridge command is the same for every client. You can configure as many
agents as you like and they will all share the single extension session.

### Claude Desktop
Edit `%APPDATA%\Claude\claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "flow": {
      "command": "node",
      "args": ["D:/Dev/flow2api/flow-mcp/bridge/dist/index.js"]
    }
  }
}
```
Restart Claude Desktop.

### Cursor
Edit `%USERPROFILE%\.cursor\mcp.json`:
```json
{
  "mcpServers": {
    "flow": {
      "command": "node",
      "args": ["D:/Dev/flow2api/flow-mcp/bridge/dist/index.js"]
    }
  }
}
```
Restart Cursor.

### Cline / Continue / others
Same shape — anything that supports MCP `command + args` over stdio works.

After restarting the agent you should see `flow_list_models`,
`flow_generate_image`, `flow_generate_video`, etc. in the tool list.

---

## 8. Quick smoke test

From a terminal (with the bridge built, the extension loaded, and the
browser running):

```powershell
node D:\Dev\flow2api\flow-mcp\test\test_image_gen.mjs
```

You should see the script connect, list models, and (if logged in) submit
an image generation.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Popup stays red, says "native host disconnected" | Manifest not registered for this browser | Re-run `install.ps1` with `-Browser Chrome` or `-Browser Edge` |
| `Specified native messaging host not found` | Wrong extension ID in manifest | Re-run installer with the correct ID, then reload extension |
| `Could not connect to flow-mcp Native Messaging host` (from agent) | Browser closed or extension not loaded | Open browser, ensure the extension is enabled and signed in |
| Port `39999` already in use | Another process bound it | Host auto-falls back to next port; bridges read `~/.flow-mcp-bridge.json`. If it still fails, set `FLOW_MCP_PORT=40500` in the agent config env. |
| `Could not bind WS port` in host stderr | Stale lock file | Delete `~/.flow-mcp-host.lock` and reload the extension |
| `auth/session: missing access_token` | Not signed into labs.google in this profile | Open https://labs.google/ in the same browser profile and log in |
| `recaptcha failed` | Google UI change broke sitekey discovery | Open the Flow project page once manually; if it persists, file an issue — the discovery in `extension/flow_api.js` (`getRecaptchaToken`) needs a tweak |
| `node not found` during install | Node not on PATH | Pass `-NodePath "C:\Program Files\nodejs\node.exe"` to `install.ps1` |
| Want to see host logs | Native host logs to stderr | On Windows, launch the browser from a terminal and watch its stderr; on macOS/Linux similarly |

### Inspecting the extension service worker
- Chrome: `chrome://extensions` → toggle Developer mode → click **service worker** under the extension → DevTools console.
- Edge:   `edge://extensions`   → same flow.

### Resetting everything
```powershell
# Stop the browser first, then:
Remove-Item C:\Users\<you>\.flow-mcp-host.lock     -ErrorAction SilentlyContinue
Remove-Item C:\Users\<you>\.flow-mcp-bridge.json   -ErrorAction SilentlyContinue
# Re-run install.ps1, reload extension.
```

---

## File / process map

```
flow-mcp/
├─ bridge/                        thin stdio MCP server, one per AI agent
│  └─ dist/index.js               <-- referenced by every agent config
├─ extension/                     loaded unpacked into Chrome/Edge
│  ├─ manifest.json
│  ├─ background.js               talks to native host via connectNative()
│  ├─ flow_api.js                 calls labs.google + reCAPTCHA in your tab
│  └─ popup.html / popup.js       status UI
└─ native-host/                   spawned by the browser, owns WS server
   ├─ host.js                     stdio NM <-> ws://127.0.0.1
   ├─ install.ps1                 Windows installer (Chrome / Edge / Both)
   ├─ install.sh                  macOS / Linux installer (Chrome)
   ├─ flow-mcp-host.bat           generated launcher (Windows)
   └─ com.flow_mcp.host.json      generated NM manifest
```

Runtime processes when one agent is running:
```
agent.exe  ──stdio──▶  node bridge/dist/index.js  ──ws──▶  node native-host/host.js  ──NM──▶  Browser extension
```

When two agents run, you get two bridge processes both connected to the same
host — no conflict, no port battles.
