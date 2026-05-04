#!/usr/bin/env node
// flow-mcp Native Messaging host.
//
// Lifecycle: spawned by Chrome when the extension calls
// chrome.runtime.connectNative("com.flow_mcp.host"). Communicates with the
// extension over stdio using Chrome's Native Messaging framing
// (4-byte little-endian length prefix + JSON body).
//
// In addition, this process owns a WebSocket server on 127.0.0.1 that any
// number of `flow-mcp-bridge` processes (one per MCP client) connect to.
// We multiplex all bridge requests onto the single native messaging channel
// to the extension and route responses back to the originating bridge.

import { WebSocketServer, WebSocket } from "ws";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";

const HOST = process.env.FLOW_MCP_HOST || "127.0.0.1";
const PORT_PREFERRED = Number(process.env.FLOW_MCP_PORT || 39999);
const HANDSHAKE_FILE = path.join(os.homedir(), ".flow-mcp-bridge.json");
const LOCK_FILE = path.join(os.homedir(), ".flow-mcp-host.lock");

// ---------- Native messaging stdio framing ----------

function sendToExtension(obj) {
  try {
    const buf = Buffer.from(JSON.stringify(obj));
    const hdr = Buffer.alloc(4);
    hdr.writeUInt32LE(buf.length, 0);
    process.stdout.write(Buffer.concat([hdr, buf]));
  } catch (e) {
    log(`sendToExtension failed: ${e?.message}`);
  }
}

let stdinBuf = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  stdinBuf = Buffer.concat([stdinBuf, chunk]);
  while (stdinBuf.length >= 4) {
    const len = stdinBuf.readUInt32LE(0);
    if (stdinBuf.length < 4 + len) break;
    const body = stdinBuf.subarray(4, 4 + len).toString("utf8");
    stdinBuf = stdinBuf.subarray(4 + len);
    try {
      handleFromExtension(JSON.parse(body));
    } catch (e) {
      log(`bad NM message: ${e?.message}`);
    }
  }
});
process.stdin.on("end", () => {
  log("extension stdin closed, exiting");
  cleanupAndExit(0);
});

// Native hosts must NOT log to stdout (it would corrupt framing). Use stderr.
function log(msg) {
  try { process.stderr.write(`[flow-mcp-host] ${msg}\n`); } catch {}
}

// ---------- Singleton lock ----------
// Chrome may spawn multiple host instances (one per connectNative call).
// Only the first should bind the WS port; the others exit cleanly.

function acquireLock() {
  // First check if a valid lock already exists
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const old = JSON.parse(fs.readFileSync(LOCK_FILE, "utf8"));
      if (old?.pid && isPidAlive(old.pid)) {
        return false;
      }
      // Stale lock – remove it before trying to create ours
      try { fs.unlinkSync(LOCK_FILE); } catch {}
    }
  } catch {}
  // Atomic create-with-exclusive to win the race between concurrent spawns
  try {
    const fd = fs.openSync(LOCK_FILE, "wx", 0o600);
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    fs.closeSync(fd);
    return true;
  } catch (e) {
    if (e.code === "EEXIST") {
      // Another process won the race; check if it's alive
      try {
        const old = JSON.parse(fs.readFileSync(LOCK_FILE, "utf8"));
        if (old?.pid && isPidAlive(old.pid)) return false;
        // Stale winner – retry once
        try { fs.unlinkSync(LOCK_FILE); } catch {}
        const fd2 = fs.openSync(LOCK_FILE, "wx", 0o600);
        fs.writeFileSync(fd2, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
        fs.closeSync(fd2);
        return true;
      } catch { return false; }
    }
    return false;
  }
}

function releaseLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const old = JSON.parse(fs.readFileSync(LOCK_FILE, "utf8"));
      if (old?.pid === process.pid) fs.unlinkSync(LOCK_FILE);
    }
  } catch {}
}

function isPidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function cleanupAndExit(code) {
  releaseLock();
  try { if (fs.existsSync(HANDSHAKE_FILE)) fs.unlinkSync(HANDSHAKE_FILE); } catch {}
  process.exit(code);
}

process.on("SIGINT", () => cleanupAndExit(0));
process.on("SIGTERM", () => cleanupAndExit(0));
process.on("exit", () => releaseLock());

// ---------- WS server (bridges connect here) ----------

/** clientId -> { ws } */
const clients = new Map();
/** key = `${clientId}:${requestId}` -> bridge clientId (used to track in-flight) */
const inflight = new Map();

let wss = null;
let actualPort = PORT_PREFERRED;

async function tryStartWss(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", (e) => {
      probe.close();
      if (e.code === "EADDRINUSE") resolve(false);
      else resolve(false);
    });
    probe.once("listening", () => {
      probe.close(() => {
        const server = new WebSocketServer({ host: HOST, port });
        server.on("listening", () => {
          wss = server;
          actualPort = port;
          attachWss();
          resolve(true);
        });
        server.on("error", () => resolve(false));
      });
    });
    probe.listen(port, HOST);
  });
}

function attachWss() {
  wss.on("connection", (ws) => {
    const clientId = crypto.randomUUID();
    clients.set(clientId, { ws });
    log(`bridge connected clientId=${clientId} (total=${clients.size})`);

    ws.on("message", (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      // bridge -> extension
      const { id, op, params } = msg || {};
      if (!id || !op) return;
      const key = `${clientId}:${id}`;
      inflight.set(key, clientId);
      sendToExtension({ clientId, id, op, params: params ?? {} });
    });

    ws.on("close", () => {
      clients.delete(clientId);
      // best-effort drop any inflight entries for this client
      for (const k of [...inflight.keys()]) {
        if (k.startsWith(`${clientId}:`)) inflight.delete(k);
      }
      log(`bridge disconnected clientId=${clientId} (total=${clients.size})`);
    });
  });
}

function writeHandshake() {
  fs.writeFileSync(
    HANDSHAKE_FILE,
    JSON.stringify({
      host: HOST,
      port: actualPort,
      pid: process.pid,
      startedAt: new Date().toISOString(),
    }, null, 2),
    { mode: 0o600 }
  );
}

// ---------- Routing extension -> bridge ----------

function handleFromExtension(msg) {
  // Expected shape: { clientId, id, ok, data?, error?, progress?, message? }
  // or unsolicited control messages: { type: "hello" | "status", ... }
  if (msg?.type === "hello") {
    log(`extension hello: ${JSON.stringify(msg).slice(0, 200)}`);
    sendToExtension({ type: "ready", host: HOST, port: actualPort });
    return;
  }
  const { clientId, id } = msg || {};
  if (!clientId || !id) return;
  const c = clients.get(clientId);
  if (!c || c.ws.readyState !== WebSocket.OPEN) {
    // bridge gone; drop
    inflight.delete(`${clientId}:${id}`);
    return;
  }
  // forward verbatim (minus clientId)
  const out = { id, ok: msg.ok, data: msg.data, error: msg.error };
  if (msg.progress) {
    out.progress = true;
    out.message = msg.message;
  } else {
    inflight.delete(`${clientId}:${id}`);
  }
  try {
    c.ws.send(JSON.stringify(out));
  } catch (e) {
    log(`forward to bridge failed: ${e?.message}`);
  }
}

// ---------- Boot ----------

(async () => {
  if (!acquireLock()) {
    log("another host instance already owns the lock; exiting");
    // Tell the extension to talk to that other instance.
    sendToExtension({ type: "redundant", message: "another flow-mcp-host is already running" });
    process.exit(0);
  }

  // Try preferred port, then a few fallbacks
  let started = false;
  for (const p of [PORT_PREFERRED, PORT_PREFERRED + 1, PORT_PREFERRED + 2, 0]) {
    if (await tryStartWss(p)) { started = true; break; }
  }
  if (!started) {
    log("failed to bind a WS port");
    sendToExtension({ type: "error", message: "could not bind WS port" });
    cleanupAndExit(1);
  }
  writeHandshake();
  log(`WS server on ws://${HOST}:${actualPort} (handshake at ${HANDSHAKE_FILE})`);
  sendToExtension({ type: "ready", host: HOST, port: actualPort });
})();
