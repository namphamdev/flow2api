// All Flow API calls happen in this Node process. The extension is only used
// as an "auth oracle":
//   - get_auth_context  -> { accessToken, expiresAt, cookieHeader, userAgent, siteKey }
//   - get_recaptcha_token({ projectId, action }) -> { token }
//
// We forge Origin/Referer/Cookie/User-Agent headers and call
// aisandbox-pa.googleapis.com / labs.google directly.

import crypto from "node:crypto";
import { ExtensionBridge } from "./bridge.js";
import { getModel, MODEL_CONFIG } from "./models.js";

const LABS_BASE = "https://labs.google/fx/api";
const API_BASE = "https://aisandbox-pa.googleapis.com/v1";
const FALLBACK_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface FlowOps {
  bridge: ExtensionBridge;
}

interface AuthContext {
  accessToken: string;
  expiresAt: number;
  cookieHeader: string;
  userAgent: string;
  siteKey: string | null;
}

let authCache: AuthContext | null = null;
let authInflight: Promise<AuthContext> | null = null;

async function refreshAuth(b: ExtensionBridge): Promise<AuthContext> {
  if (authInflight) return authInflight;
  authInflight = (async () => {
    const ctx = await b.call<AuthContext>("get_auth_context", {}, { timeoutMs: 30_000 });
    if (!ctx?.accessToken) throw new Error("get_auth_context returned no accessToken");
    authCache = {
      accessToken: ctx.accessToken,
      expiresAt: Number(ctx.expiresAt) || Date.now() + 25 * 60_000,
      cookieHeader: ctx.cookieHeader || "",
      userAgent: ctx.userAgent || FALLBACK_UA,
      siteKey: ctx.siteKey || null,
    };
    return authCache;
  })().finally(() => { authInflight = null; });
  return authInflight;
}

async function auth(b: ExtensionBridge): Promise<AuthContext> {
  if (authCache && Date.now() < authCache.expiresAt - 60_000) return authCache;
  return refreshAuth(b);
}

function commonHeaders(a: AuthContext, contentType?: string): Record<string, string> {
  const h: Record<string, string> = {
    "Authorization": `Bearer ${a.accessToken}`,
    "Origin": "https://labs.google",
    "Referer": "https://labs.google/",
    "User-Agent": a.userAgent || FALLBACK_UA,
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Fetch-Site": "cross-site",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
    "X-Goog-AuthUser": "0",
  };
  if (a.cookieHeader) h["Cookie"] = a.cookieHeader;
  if (contentType) h["Content-Type"] = contentType;
  return h;
}

async function apiDirect<T = any>(
  b: ExtensionBridge,
  path: string,
  body?: unknown,
  opts: { method?: "GET" | "POST"; retried?: boolean } = {}
): Promise<T> {
  const method = opts.method ?? "POST";
  const a = await auth(b);
  const r = await fetch(`${API_BASE}${path}`, {
    method,
    headers: commonHeaders(a, method === "GET" ? undefined : "text/plain;charset=UTF-8"),
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  const text = await r.text();
  if (!r.ok) {
    if (r.status === 401 && !opts.retried) {
      authCache = null;
      return apiDirect<T>(b, path, body, { ...opts, retried: true });
    }
    throw new Error(`api ${path} ${r.status}: ${text.slice(0, 400)}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

async function trpcDirect<T = any>(
  b: ExtensionBridge,
  name: string,
  payload: unknown,
  opts: { retried?: boolean } = {}
): Promise<T> {
  const a = await auth(b);
  const r = await fetch(`${LABS_BASE}/trpc/${name}`, {
    method: "POST",
    headers: {
      ...commonHeaders(a, "application/json"),
      // labs.google/fx/api accepts JSON content-type for trpc
      "Origin": "https://labs.google",
      "Referer": "https://labs.google/fx/tools/flow",
    },
    body: JSON.stringify({ json: payload }),
  });
  const text = await r.text();
  if (!r.ok) {
    if (r.status === 401 && !opts.retried) {
      authCache = null;
      return trpcDirect<T>(b, name, payload, { retried: true });
    }
    throw new Error(`trpc ${name} ${r.status}: ${text.slice(0, 400)}`);
  }
  return JSON.parse(text);
}

async function recaptcha(
  b: ExtensionBridge,
  projectId: string | null,
  action: string
): Promise<string> {
  const r = await b.call<{ token: string }>(
    "get_recaptcha_token",
    { projectId, action },
    { timeoutMs: 30_000 }
  );
  if (!r?.token) throw new Error("recaptcha: empty token");
  return r.token;
}

function generateSessionId() {
  return crypto.randomUUID();
}

// ---------------- Public ops (called by the MCP server) ----------------

export async function getCredits(ctx: FlowOps) {
  return apiDirect(ctx.bridge, "/credits", undefined, { method: "GET" });
}

export async function listProjects(ctx: FlowOps) {
  return trpcDirect(ctx.bridge, "project.listProjects", {});
}

export async function createProject(ctx: FlowOps, title: string) {
  const r: any = await trpcDirect(ctx.bridge, "project.createProject", {
    projectTitle: title,
    toolName: "PINHOLE",
  });
  const projectId =
    r?.result?.data?.json?.result?.projectId ||
    r?.result?.data?.json?.projectId;
  if (!projectId) {
    throw new Error(`createProject: missing projectId in ${JSON.stringify(r).slice(0, 200)}`);
  }
  return { projectId };
}

export async function deleteProject(ctx: FlowOps, projectId: string) {
  await trpcDirect(ctx.bridge, "project.deleteProject", { projectToDeleteId: projectId });
  return { ok: true };
}

export async function uploadImage(ctx: FlowOps, opts: {
  projectId?: string;
  imageBase64: string;
  mimeType?: string;
  aspectRatio?: string;
}) {
  const mimeType = opts.mimeType || "image/jpeg";
  const aspectRatio = opts.aspectRatio || "IMAGE_ASPECT_RATIO_LANDSCAPE";
  const fileName = `flow-mcp_${Date.now()}.${mimeType.includes("png") ? "png" : "jpg"}`;
  const clientContext: any = { tool: "PINHOLE" };
  if (opts.projectId) clientContext.projectId = opts.projectId;
  try {
    const r: any = await apiDirect(ctx.bridge, "/flow/uploadImage", {
      clientContext,
      fileName,
      imageBytes: opts.imageBase64,
      isHidden: false,
      isUserUploaded: true,
      mimeType,
    });
    const mediaId = r?.media?.name || r?.mediaGenerationId?.mediaGenerationId;
    if (mediaId) return { mediaId };
    throw new Error(`upload_image: no mediaId, keys=${Object.keys(r).join(",")}`);
  } catch (e) {
    if (opts.projectId) throw e;
    const r: any = await apiDirect(ctx.bridge, "/media:uploadUserImage", {
      imageInput: {
        rawImageBytes: opts.imageBase64,
        mimeType,
        isUserUploaded: true,
        aspectRatio,
      },
      clientContext: { sessionId: generateSessionId(), tool: "ASSET_MANAGER" },
    });
    const mediaId = r?.mediaGenerationId?.mediaGenerationId || r?.media?.name;
    if (!mediaId) throw new Error("legacy upload_image: no mediaId");
    return { mediaId };
  }
}

export async function generateImage(ctx: FlowOps, opts: {
  projectId: string;
  prompt: string;
  model: string;
  imageInputs?: Array<{ mediaId: string }>;
}) {
  const m = getModel(opts.model);
  if (m.type !== "image") throw new Error(`${opts.model} is not an image model`);
  const recaptchaToken = await recaptcha(ctx.bridge, opts.projectId, "IMAGE_GENERATION");
  const sessionId = `;${Date.now()}`;
  const clientContext = {
    recaptchaContext: { token: recaptchaToken, applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB" },
    projectId: opts.projectId,
    tool: "PINHOLE",
    sessionId,
  };
  const requestData = {
    clientContext,
    imageModelName: m.model_name,
    imageAspectRatio: m.aspect_ratio,
    structuredPrompt: { parts: [{ text: opts.prompt }] },
    seed: Math.floor(Math.random() * 999999) + 1,
    imageInputs: (opts.imageInputs || []).map((i) => ({ mediaId: i.mediaId })),
  };
  const r: any = await apiDirect(
    ctx.bridge,
    `/projects/${opts.projectId}/flowMedia:batchGenerateImages`,
    {
      clientContext,
      mediaGenerationContext: { batchId: crypto.randomUUID() },
      useNewMedia: true,
      requests: [requestData],
    }
  );
  const upsample = m.upsample;
  if (upsample) {
    const generated = r?.imagePanels?.[0]?.generatedImages || r?.images || [];
    if (generated[0]) {
      const mediaId = generated[0]?.mediaGenerationId || generated[0]?.media?.name;
      if (mediaId) {
        const up = await apiDirect(ctx.bridge, "/flow/upsampleImage", {
          clientContext,
          mediaGenerationId: mediaId,
          resolution: typeof upsample === "string" ? upsample : upsample.resolution,
        });
        return { generation: r, upsample: up };
      }
    }
  }
  return { generation: r };
}

export async function generateVideo(ctx: FlowOps, opts: {
  projectId: string;
  prompt: string;
  model: string;
  imageInputs?: Array<{ mediaId: string; role?: "first" | "last" | "reference" }>;
  userPaygateTier?: string;
}) {
  const m = getModel(opts.model);
  if (m.type !== "video") throw new Error(`${opts.model} is not a video model`);
  if (m.supports_images) {
    const n = (opts.imageInputs || []).length;
    if (typeof m.min_images === "number" && n < m.min_images)
      throw new Error(`${opts.model} requires at least ${m.min_images} image(s)`);
    if (typeof m.max_images === "number" && n > m.max_images)
      throw new Error(`${opts.model} accepts at most ${m.max_images} image(s)`);
  } else if (opts.imageInputs && opts.imageInputs.length > 0) {
    throw new Error(`${opts.model} does not accept image inputs`);
  }

  const recaptchaToken = await recaptcha(ctx.bridge, opts.projectId, "VIDEO_GENERATION");
  const sessionId = `;${Date.now()}`;
  const sceneId = crypto.randomUUID();
  const clientContext: any = {
    recaptchaContext: { token: recaptchaToken, applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB" },
    projectId: opts.projectId,
    tool: "PINHOLE",
    sessionId,
    userPaygateTier: opts.userPaygateTier ?? "PAYGATE_TIER_ONE",
  };
  const useV2 = !!m.use_v2_model_config;

  let url: string;
  let requestData: any;
  if (m.video_type === "t2v") {
    url = "/video:batchAsyncGenerateVideoText";
    requestData = {
      aspectRatio: m.aspect_ratio,
      seed: Math.floor(Math.random() * 99999) + 1,
      videoModelKey: m.model_key,
      metadata: { sceneId },
      ...(useV2
        ? { structuredPrompt: { parts: [{ text: opts.prompt }] } }
        : { textInput: { prompt: opts.prompt } }),
    };
  } else if (m.video_type === "i2v") {
    const imgs = opts.imageInputs || [];
    const first = imgs.find((i) => i.role === "first") || imgs[0];
    const last = imgs.find((i) => i.role === "last") || (imgs.length === 2 ? imgs[1] : null);
    if (last) {
      url = "/video:batchAsyncGenerateVideoStartAndEndImage";
      requestData = {
        aspectRatio: m.aspect_ratio,
        seed: Math.floor(Math.random() * 99999) + 1,
        videoModelKey: m.model_key,
        metadata: { sceneId },
        startImage: { mediaId: first.mediaId },
        endImage: { mediaId: last.mediaId },
        ...(useV2
          ? { structuredPrompt: { parts: [{ text: opts.prompt }] } }
          : { textInput: { prompt: opts.prompt } }),
      };
    } else {
      url = "/video:batchAsyncGenerateVideoStartImage";
      requestData = {
        aspectRatio: m.aspect_ratio,
        seed: Math.floor(Math.random() * 99999) + 1,
        videoModelKey: m.model_key,
        metadata: { sceneId },
        startImage: { mediaId: first.mediaId },
        ...(useV2
          ? { structuredPrompt: { parts: [{ text: opts.prompt }] } }
          : { textInput: { prompt: opts.prompt } }),
      };
    }
  } else if (m.video_type === "r2v") {
    url = "/video:batchAsyncGenerateVideoReferenceImages";
    requestData = {
      aspectRatio: m.aspect_ratio,
      seed: Math.floor(Math.random() * 99999) + 1,
      videoModelKey: m.model_key,
      metadata: { sceneId },
      referenceImages: (opts.imageInputs || []).map((i) => ({
        imageUsageType: "IMAGE_USAGE_TYPE_ASSET",
        mediaId: i.mediaId,
      })),
      ...(useV2
        ? { structuredPrompt: { parts: [{ text: opts.prompt }] } }
        : { textInput: { prompt: opts.prompt } }),
    };
  } else {
    throw new Error(`unknown videoType ${m.video_type}`);
  }

  const body: any = {
    clientContext,
    requests: [requestData],
    ...(useV2 ? { useV2ModelConfig: true, mediaGenerationContext: { batchId: crypto.randomUUID() } } : {}),
  };
  const r: any = await apiDirect(ctx.bridge, url, body);
  return { ...r, _upsample: m.upsample ?? null };
}

export async function pollVideo(ctx: FlowOps, operations: Array<any>) {
  return apiDirect(ctx.bridge, "/video:batchCheckAsyncVideoGenerationStatus", { operations });
}

export async function waitVideo(
  ctx: FlowOps,
  operations: Array<any>,
  timeoutMs = 25 * 60_000,
  onProgress?: (msg: string) => void
) {
  const start = Date.now();
  let ops = operations;
  let interval = 5000;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (Date.now() - start > timeoutMs) throw new Error("wait_video timed out");
    const r: any = await apiDirect(
      ctx.bridge,
      "/video:batchCheckAsyncVideoGenerationStatus",
      { operations: ops }
    );
    const list = r?.operations || [];
    const allDone = list.every((o: any) => {
      const s = o?.status || o?.operation?.metadata?.status;
      return s && s !== "MEDIA_GENERATION_STATUS_PENDING" && s !== "MEDIA_GENERATION_STATUS_RUNNING";
    });
    if (onProgress) {
      const summary = list
        .map((o: any) => `${o?.operation?.name?.split("/").pop()}=${o?.status}`)
        .join(", ");
      onProgress(`status: ${summary}`);
    }
    if (allDone) return r;
    ops = list.map((o: any) => ({
      operation: { name: o?.operation?.name },
      sceneId: o?.sceneId,
      status: o?.status,
    }));
    await new Promise((res) => setTimeout(res, interval));
    interval = Math.min(interval + 1000, 15000);
  }
}

export function listKnownModels() {
  return Object.entries(MODEL_CONFIG).map(([id, m]) => ({
    id,
    type: m.type,
    video_type: m.video_type,
    aspect_ratio: m.aspect_ratio,
    supports_images: !!m.supports_images,
    min_images: m.min_images ?? 0,
    max_images: m.max_images ?? 0,
  }));
}
