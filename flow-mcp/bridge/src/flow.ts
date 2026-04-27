// Helpers to translate MCP tool inputs into the extension `op` calls.
// The extension is the actual HTTP client (it owns labs.google cookies + reCAPTCHA).
// We just shape the payloads here using MODEL_CONFIG.

import { ExtensionBridge } from "./bridge.js";
import { getModel, MODEL_CONFIG } from "./models.js";

export interface FlowOps {
  bridge: ExtensionBridge;
}

export async function getCredits(ctx: FlowOps) {
  return ctx.bridge.call("get_credits", {});
}

export async function listProjects(ctx: FlowOps) {
  return ctx.bridge.call("list_projects", {});
}

export async function createProject(ctx: FlowOps, title: string) {
  return ctx.bridge.call("create_project", { title });
}

export async function deleteProject(ctx: FlowOps, projectId: string) {
  return ctx.bridge.call("delete_project", { projectId });
}

export async function uploadImage(ctx: FlowOps, opts: {
  projectId?: string;
  imageBase64: string;     // raw base64 (no data: prefix)
  mimeType?: string;       // image/jpeg | image/png | image/webp
  aspectRatio?: string;    // IMAGE_ASPECT_RATIO_*
}) {
  return ctx.bridge.call<{ mediaId: string }>("upload_image", opts);
}

export async function generateImage(ctx: FlowOps, opts: {
  projectId: string;
  prompt: string;
  model: string;                       // e.g. gemini-3.1-flash-image-landscape
  imageInputs?: Array<{ mediaId: string }>; // optional reference images
}) {
  const m = getModel(opts.model);
  if (m.type !== "image") throw new Error(`${opts.model} is not an image model`);
  return ctx.bridge.call("generate_image", {
    projectId: opts.projectId,
    prompt: opts.prompt,
    modelName: m.model_name,
    aspectRatio: m.aspect_ratio,
    upsample: m.upsample ?? null,
    imageInputs: (opts.imageInputs || []).map((i) => ({
      mediaId: i.mediaId,
    })),
  }, { timeoutMs: 180_000 });
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
  return ctx.bridge.call<{ operations: Array<{ operation: { name: string }; sceneId?: string; status?: string }>; remainingCredits?: number }>("generate_video", {
    projectId: opts.projectId,
    prompt: opts.prompt,
    videoType: m.video_type,
    modelKey: m.model_key,
    aspectRatio: m.aspect_ratio,
    imageInputs: opts.imageInputs || [],
    useV2ModelConfig: !!m.use_v2_model_config,
    upsample: m.upsample ?? null,
    userPaygateTier: opts.userPaygateTier ?? "PAYGATE_TIER_ONE",
  }, { timeoutMs: 180_000 });
}

export async function pollVideo(ctx: FlowOps, operations: Array<{ operation: { name: string }; sceneId?: string; status?: string }>) {
  return ctx.bridge.call("poll_video", { operations });
}

export async function waitVideo(ctx: FlowOps, operations: Array<{ operation: { name: string }; sceneId?: string; status?: string }>, timeoutMs = 25 * 60_000, onProgress?: (msg: string) => void) {
  return ctx.bridge.call("wait_video", { operations, timeoutMs }, { timeoutMs, onProgress });
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
