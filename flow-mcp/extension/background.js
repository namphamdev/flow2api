// Background service worker: maintains a Native Messaging connection to the
// local `com.flow_mcp.host` process and dispatches incoming messages from any
// number of bridge clients (multiplexed by clientId) to the flow API.

import { ops } from "./flow_api.js";

const NATIVE_HOST = "com.flow_mcp.host";

let port = null;
let connecting = false;
let backoff = 1000;

async function setStatus(connected, info = "") {
  await chrome.storage.local.set({ connected, lastInfo: info, lastUpdate: Date.now() });
}

function postNative(obj) {
  if (!port) return;
  try { port.postMessage(obj); }
  catch (e) { console.error("postMessage failed", e); }
}

function progressSender(clientId, id) {
  return (message) => postNative({ clientId, id, ok: true, progress: true, message });
}

async function handleRequest(msg) {
  const { clientId, id, op, params } = msg;
  const handler = ops[op];
  if (!handler) {
    postNative({ clientId, id, ok: false, error: `unknown op ${op}` });
    return;
  }
  try {
    const data = op === "wait_video"
      ? await handler(params || {}, progressSender(clientId, id))
      : await handler(params || {});
    postNative({ clientId, id, ok: true, data });
  } catch (err) {
    postNative({ clientId, id, ok: false, error: err?.message || String(err) });
  }
}

function handleMessage(msg) {
  if (!msg || typeof msg !== "object") return;
  // control messages from native host
  if (msg.type === "ready") {
    setStatus(true, `native host ready (ws://${msg.host}:${msg.port})`);
    return;
  }
  if (msg.type === "error") {
    setStatus(false, `native host error: ${msg.message}`);
    return;
  }
  if (msg.type === "redundant") {
    // duplicate spawn, native host already running; just close this port and
    // let chrome alarm reconnect (which will reuse the existing one).
    setStatus(true, "native host already running");
    return;
  }
  // bridge -> extension request
  if (msg.clientId && msg.id && msg.op) {
    handleRequest(msg);
  }
}

function connect() {
  if (connecting) return;
  connecting = true;
  try {
    port = chrome.runtime.connectNative(NATIVE_HOST);
  } catch (e) {
    connecting = false;
    setStatus(false, `connectNative threw: ${e?.message}`);
    scheduleReconnect();
    return;
  }
  // Announce ourselves so the host can log it.
  try {
    port.postMessage({ type: "hello", from: "extension", at: Date.now() });
  } catch {}
  port.onMessage.addListener(handleMessage);
  port.onDisconnect.addListener(() => {
    connecting = false;
    const err = chrome.runtime.lastError?.message || "disconnected";
    setStatus(false, `native host disconnected: ${err}`);
    port = null;
    scheduleReconnect();
  });
  // initial status (may be overridden by `ready` from host)
  setStatus(true, "native host connecting");
  backoff = 1000;
  connecting = false;
}

let reconnectTimer = null;

function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, backoff);
  backoff = Math.min(backoff * 2, 15000);
}

// keep service worker alive while we have an open port
chrome.alarms.create("keepalive", { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "keepalive" && !port && !connecting) connect();
});

chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
connect();

// Allow popup to trigger an immediate reconnect.
chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  if (msg?.type === "reconnect") {
    try { port?.disconnect(); } catch {}
    port = null;
    connect();
    sendResponse({ ok: true });
  }
  return true;
});
