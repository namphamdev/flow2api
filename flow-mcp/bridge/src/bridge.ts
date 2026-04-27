// WS client of the local flow-mcp Native Messaging host. Many bridge processes
// can run concurrently (one per MCP client) and all multiplex through the
// single host instance.
//
// Wire protocol (bridge -> host):  { id, op, params }
// Wire protocol (host -> bridge):  { id, ok, data?, error?, progress?, message? }

import { WebSocket } from "ws";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface BridgeOptions {
  host?: string;
  port?: number;
}

export type ExtensionRequest = {
  id: string;
  op: string;
  params?: unknown;
};

export type ExtensionResponse = {
  id: string;
  ok: boolean;
  data?: unknown;
  error?: string;
  progress?: boolean;
  message?: string;
};

type Pending = {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  onProgress?: (msg: string) => void;
  timer: NodeJS.Timeout;
};

const HANDSHAKE_FILE = path.join(os.homedir(), ".flow-mcp-bridge.json");

function readHandshake(): { host: string; port: number } | null {
  try {
    if (!fs.existsSync(HANDSHAKE_FILE)) return null;
    const j = JSON.parse(fs.readFileSync(HANDSHAKE_FILE, "utf8"));
    if (typeof j?.host === "string" && typeof j?.port === "number") {
      return { host: j.host, port: j.port };
    }
  } catch {}
  return null;
}

export class ExtensionBridge {
  private socket: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private connecting: Promise<void> | null = null;
  private backoffMs = 500;
  private host: string;
  private port: number;

  constructor(opts: BridgeOptions = {}) {
    const hs = readHandshake();
    this.host = opts.host ?? process.env.FLOW_MCP_HOST ?? hs?.host ?? "127.0.0.1";
    this.port = opts.port ?? Number(process.env.FLOW_MCP_PORT || hs?.port || 39999);
    // kick off an initial connection attempt; failures are retried lazily.
    this.ensureConnected().catch(() => {});
  }

  private async ensureConnected(): Promise<void> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) return;
    if (this.connecting) return this.connecting;
    this.connecting = new Promise<void>((resolve, reject) => {
      // re-read handshake each time in case the host restarted on a new port
      const hs = readHandshake();
      const host = process.env.FLOW_MCP_HOST ?? hs?.host ?? this.host;
      const port = Number(process.env.FLOW_MCP_PORT || hs?.port || this.port);
      this.host = host;
      this.port = port;
      const ws = new WebSocket(`ws://${host}:${port}/`);
      const onError = (e: Error) => {
        ws.removeAllListeners();
        this.connecting = null;
        reject(e);
      };
      ws.once("error", onError);
      ws.once("open", () => {
        ws.removeListener("error", onError);
        this.socket = ws;
        this.attach(ws);
        this.backoffMs = 500;
        process.stderr.write(`[bridge] connected to native host ws://${host}:${port}\n`);
        this.connecting = null;
        resolve();
      });
    });
    return this.connecting;
  }

  private attach(ws: WebSocket) {
    ws.on("message", (raw) => {
      let msg: ExtensionResponse;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      const p = this.pending.get(msg.id);
      if (!p) return;
      if (msg.progress) {
        p.onProgress?.(msg.message || "");
        return;
      }
      clearTimeout(p.timer);
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.data);
      else p.reject(new Error(msg.error || "extension error"));
    });
    ws.on("close", () => {
      if (this.socket === ws) this.socket = null;
      // reject everything pending; the MCP client will retry the tool call.
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error("native host connection closed"));
      }
      this.pending.clear();
      process.stderr.write("[bridge] disconnected from native host\n");
    });
    ws.on("error", () => { /* handled via close */ });
  }

  isConnected(): boolean {
    return !!this.socket && this.socket.readyState === WebSocket.OPEN;
  }

  async call<T = unknown>(
    op: string,
    params: unknown = {},
    opts: { timeoutMs?: number; onProgress?: (msg: string) => void } = {}
  ): Promise<T> {
    // Try to connect with simple backoff before failing the call.
    const deadline = Date.now() + 5000;
    while (!this.isConnected()) {
      try { await this.ensureConnected(); break; }
      catch {
        if (Date.now() > deadline) {
          throw new Error(
            "Could not connect to flow-mcp Native Messaging host. " +
            "Make sure Chrome is running with the flow-mcp extension loaded and " +
            "the native host is installed (see flow-mcp/native-host/install.{ps1,sh})."
          );
        }
        await new Promise((r) => setTimeout(r, this.backoffMs));
        this.backoffMs = Math.min(this.backoffMs * 2, 3000);
      }
    }
    const id = crypto.randomUUID();
    const timeoutMs = opts.timeoutMs ?? 120_000;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`extension call ${op} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (data) => resolve(data as T),
        reject,
        onProgress: opts.onProgress,
        timer,
      });
      this.socket!.send(JSON.stringify({ id, op, params } satisfies ExtensionRequest));
    });
  }
}
