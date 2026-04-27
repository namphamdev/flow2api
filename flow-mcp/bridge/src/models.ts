// Ported from src/services/generation_handler.py MODEL_CONFIG
// Single source of truth for model_key + aspect_ratio + endpoint selection.

export type ModelType = "image" | "video";
export type VideoType = "t2v" | "i2v" | "r2v";

export interface UpsampleConfig {
  resolution: string;
  model_key: string;
}

export interface ModelEntry {
  type: ModelType;
  // image
  model_name?: string;            // GEM_PIX | GEM_PIX_2 | NARWHAL | IMAGEN_3_5
  aspect_ratio: string;           // IMAGE_ASPECT_RATIO_* | VIDEO_ASPECT_RATIO_*
  upsample?: string | UpsampleConfig;
  // video
  video_type?: VideoType;
  model_key?: string;
  supports_images?: boolean;
  min_images?: number;
  max_images?: number;
  use_v2_model_config?: boolean;
  allow_tier_upgrade?: boolean;
}

export const MODEL_CONFIG: Record<string, ModelEntry> = {
  // ---- Image: GEM_PIX (Gemini 2.5 Flash) ----
  "gemini-2.5-flash-image-landscape": { type: "image", model_name: "GEM_PIX", aspect_ratio: "IMAGE_ASPECT_RATIO_LANDSCAPE" },
  "gemini-2.5-flash-image-portrait": { type: "image", model_name: "GEM_PIX", aspect_ratio: "IMAGE_ASPECT_RATIO_PORTRAIT" },

  // ---- Image: GEM_PIX_2 (Gemini 3.0 Pro) ----
  "gemini-3.0-pro-image-landscape":   { type: "image", model_name: "GEM_PIX_2", aspect_ratio: "IMAGE_ASPECT_RATIO_LANDSCAPE" },
  "gemini-3.0-pro-image-portrait":    { type: "image", model_name: "GEM_PIX_2", aspect_ratio: "IMAGE_ASPECT_RATIO_PORTRAIT" },
  "gemini-3.0-pro-image-square":      { type: "image", model_name: "GEM_PIX_2", aspect_ratio: "IMAGE_ASPECT_RATIO_SQUARE" },
  "gemini-3.0-pro-image-four-three":  { type: "image", model_name: "GEM_PIX_2", aspect_ratio: "IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE" },
  "gemini-3.0-pro-image-three-four":  { type: "image", model_name: "GEM_PIX_2", aspect_ratio: "IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR" },

  "gemini-3.0-pro-image-landscape-2k":  { type: "image", model_name: "GEM_PIX_2", aspect_ratio: "IMAGE_ASPECT_RATIO_LANDSCAPE",          upsample: "UPSAMPLE_IMAGE_RESOLUTION_2K" },
  "gemini-3.0-pro-image-portrait-2k":   { type: "image", model_name: "GEM_PIX_2", aspect_ratio: "IMAGE_ASPECT_RATIO_PORTRAIT",           upsample: "UPSAMPLE_IMAGE_RESOLUTION_2K" },
  "gemini-3.0-pro-image-square-2k":     { type: "image", model_name: "GEM_PIX_2", aspect_ratio: "IMAGE_ASPECT_RATIO_SQUARE",             upsample: "UPSAMPLE_IMAGE_RESOLUTION_2K" },
  "gemini-3.0-pro-image-four-three-2k": { type: "image", model_name: "GEM_PIX_2", aspect_ratio: "IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE", upsample: "UPSAMPLE_IMAGE_RESOLUTION_2K" },
  "gemini-3.0-pro-image-three-four-2k": { type: "image", model_name: "GEM_PIX_2", aspect_ratio: "IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR",  upsample: "UPSAMPLE_IMAGE_RESOLUTION_2K" },

  "gemini-3.0-pro-image-landscape-4k":  { type: "image", model_name: "GEM_PIX_2", aspect_ratio: "IMAGE_ASPECT_RATIO_LANDSCAPE",          upsample: "UPSAMPLE_IMAGE_RESOLUTION_4K" },
  "gemini-3.0-pro-image-portrait-4k":   { type: "image", model_name: "GEM_PIX_2", aspect_ratio: "IMAGE_ASPECT_RATIO_PORTRAIT",           upsample: "UPSAMPLE_IMAGE_RESOLUTION_4K" },
  "gemini-3.0-pro-image-square-4k":     { type: "image", model_name: "GEM_PIX_2", aspect_ratio: "IMAGE_ASPECT_RATIO_SQUARE",             upsample: "UPSAMPLE_IMAGE_RESOLUTION_4K" },
  "gemini-3.0-pro-image-four-three-4k": { type: "image", model_name: "GEM_PIX_2", aspect_ratio: "IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE", upsample: "UPSAMPLE_IMAGE_RESOLUTION_4K" },
  "gemini-3.0-pro-image-three-four-4k": { type: "image", model_name: "GEM_PIX_2", aspect_ratio: "IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR",  upsample: "UPSAMPLE_IMAGE_RESOLUTION_4K" },

  // ---- Image: IMAGEN_3_5 (Imagen 4.0) ----
  "imagen-4.0-generate-preview-landscape": { type: "image", model_name: "IMAGEN_3_5", aspect_ratio: "IMAGE_ASPECT_RATIO_LANDSCAPE" },
  "imagen-4.0-generate-preview-portrait":  { type: "image", model_name: "IMAGEN_3_5", aspect_ratio: "IMAGE_ASPECT_RATIO_PORTRAIT" },

  // ---- Image: NARWHAL (Gemini 3.1 Flash) ----
  "gemini-3.1-flash-image-landscape":  { type: "image", model_name: "NARWHAL", aspect_ratio: "IMAGE_ASPECT_RATIO_LANDSCAPE" },
  "gemini-3.1-flash-image-portrait":   { type: "image", model_name: "NARWHAL", aspect_ratio: "IMAGE_ASPECT_RATIO_PORTRAIT" },
  "gemini-3.1-flash-image-square":     { type: "image", model_name: "NARWHAL", aspect_ratio: "IMAGE_ASPECT_RATIO_SQUARE" },
  "gemini-3.1-flash-image-four-three": { type: "image", model_name: "NARWHAL", aspect_ratio: "IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE" },
  "gemini-3.1-flash-image-three-four": { type: "image", model_name: "NARWHAL", aspect_ratio: "IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR" },

  "gemini-3.1-flash-image-landscape-2k":  { type: "image", model_name: "NARWHAL", aspect_ratio: "IMAGE_ASPECT_RATIO_LANDSCAPE",          upsample: "UPSAMPLE_IMAGE_RESOLUTION_2K" },
  "gemini-3.1-flash-image-portrait-2k":   { type: "image", model_name: "NARWHAL", aspect_ratio: "IMAGE_ASPECT_RATIO_PORTRAIT",           upsample: "UPSAMPLE_IMAGE_RESOLUTION_2K" },
  "gemini-3.1-flash-image-square-2k":     { type: "image", model_name: "NARWHAL", aspect_ratio: "IMAGE_ASPECT_RATIO_SQUARE",             upsample: "UPSAMPLE_IMAGE_RESOLUTION_2K" },
  "gemini-3.1-flash-image-four-three-2k": { type: "image", model_name: "NARWHAL", aspect_ratio: "IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE", upsample: "UPSAMPLE_IMAGE_RESOLUTION_2K" },
  "gemini-3.1-flash-image-three-four-2k": { type: "image", model_name: "NARWHAL", aspect_ratio: "IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR",  upsample: "UPSAMPLE_IMAGE_RESOLUTION_2K" },

  "gemini-3.1-flash-image-landscape-4k":  { type: "image", model_name: "NARWHAL", aspect_ratio: "IMAGE_ASPECT_RATIO_LANDSCAPE",          upsample: "UPSAMPLE_IMAGE_RESOLUTION_4K" },
  "gemini-3.1-flash-image-portrait-4k":   { type: "image", model_name: "NARWHAL", aspect_ratio: "IMAGE_ASPECT_RATIO_PORTRAIT",           upsample: "UPSAMPLE_IMAGE_RESOLUTION_4K" },
  "gemini-3.1-flash-image-square-4k":     { type: "image", model_name: "NARWHAL", aspect_ratio: "IMAGE_ASPECT_RATIO_SQUARE",             upsample: "UPSAMPLE_IMAGE_RESOLUTION_4K" },
  "gemini-3.1-flash-image-four-three-4k": { type: "image", model_name: "NARWHAL", aspect_ratio: "IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE", upsample: "UPSAMPLE_IMAGE_RESOLUTION_4K" },
  "gemini-3.1-flash-image-three-four-4k": { type: "image", model_name: "NARWHAL", aspect_ratio: "IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR",  upsample: "UPSAMPLE_IMAGE_RESOLUTION_4K" },

  // ---- Video: T2V ----
  "veo_3_1_t2v_fast_portrait":               { type: "video", video_type: "t2v", model_key: "veo_3_1_t2v_fast_portrait",               aspect_ratio: "VIDEO_ASPECT_RATIO_PORTRAIT",  supports_images: false },
  "veo_3_1_t2v_fast_landscape":              { type: "video", video_type: "t2v", model_key: "veo_3_1_t2v_fast",                         aspect_ratio: "VIDEO_ASPECT_RATIO_LANDSCAPE", supports_images: false },
  "veo_3_1_t2v_fast_portrait_ultra":         { type: "video", video_type: "t2v", model_key: "veo_3_1_t2v_fast_portrait_ultra",         aspect_ratio: "VIDEO_ASPECT_RATIO_PORTRAIT",  supports_images: false },
  "veo_3_1_t2v_fast_ultra":                  { type: "video", video_type: "t2v", model_key: "veo_3_1_t2v_fast_ultra",                  aspect_ratio: "VIDEO_ASPECT_RATIO_LANDSCAPE", supports_images: false },
  "veo_3_1_t2v_fast_portrait_ultra_relaxed": { type: "video", video_type: "t2v", model_key: "veo_3_1_t2v_fast_portrait_ultra_relaxed", aspect_ratio: "VIDEO_ASPECT_RATIO_PORTRAIT",  supports_images: false },
  "veo_3_1_t2v_fast_ultra_relaxed":          { type: "video", video_type: "t2v", model_key: "veo_3_1_t2v_fast_ultra_relaxed",          aspect_ratio: "VIDEO_ASPECT_RATIO_LANDSCAPE", supports_images: false },
  "veo_3_1_t2v_portrait":                    { type: "video", video_type: "t2v", model_key: "veo_3_1_t2v_portrait",                    aspect_ratio: "VIDEO_ASPECT_RATIO_PORTRAIT",  supports_images: false },
  "veo_3_1_t2v_landscape":                   { type: "video", video_type: "t2v", model_key: "veo_3_1_t2v",                              aspect_ratio: "VIDEO_ASPECT_RATIO_LANDSCAPE", supports_images: false },
  "veo_3_1_t2v_lite_portrait":               { type: "video", video_type: "t2v", model_key: "veo_3_1_t2v_lite",                         aspect_ratio: "VIDEO_ASPECT_RATIO_PORTRAIT",  supports_images: false, use_v2_model_config: true, allow_tier_upgrade: false },
  "veo_3_1_t2v_lite_landscape":              { type: "video", video_type: "t2v", model_key: "veo_3_1_t2v_lite",                         aspect_ratio: "VIDEO_ASPECT_RATIO_LANDSCAPE", supports_images: false, use_v2_model_config: true, allow_tier_upgrade: false },

  // ---- Video: I2V (start/end frames) ----
  "veo_3_1_i2v_s_fast_portrait_fl":               { type: "video", video_type: "i2v", model_key: "veo_3_1_i2v_s_fast_portrait_fl",               aspect_ratio: "VIDEO_ASPECT_RATIO_PORTRAIT",  supports_images: true, min_images: 1, max_images: 2 },
  "veo_3_1_i2v_s_fast_fl":                        { type: "video", video_type: "i2v", model_key: "veo_3_1_i2v_s_fast_fl",                         aspect_ratio: "VIDEO_ASPECT_RATIO_LANDSCAPE", supports_images: true, min_images: 1, max_images: 2 },
  "veo_3_1_i2v_s_fast_portrait_ultra_fl":         { type: "video", video_type: "i2v", model_key: "veo_3_1_i2v_s_fast_portrait_ultra_fl",         aspect_ratio: "VIDEO_ASPECT_RATIO_PORTRAIT",  supports_images: true, min_images: 1, max_images: 2 },
  "veo_3_1_i2v_s_fast_ultra_fl":                  { type: "video", video_type: "i2v", model_key: "veo_3_1_i2v_s_fast_ultra_fl",                  aspect_ratio: "VIDEO_ASPECT_RATIO_LANDSCAPE", supports_images: true, min_images: 1, max_images: 2 },
  "veo_3_1_i2v_s_fast_portrait_ultra_relaxed":    { type: "video", video_type: "i2v", model_key: "veo_3_1_i2v_s_fast_portrait_ultra_relaxed",    aspect_ratio: "VIDEO_ASPECT_RATIO_PORTRAIT",  supports_images: true, min_images: 1, max_images: 2 },
  "veo_3_1_i2v_s_fast_ultra_relaxed":             { type: "video", video_type: "i2v", model_key: "veo_3_1_i2v_s_fast_ultra_relaxed",             aspect_ratio: "VIDEO_ASPECT_RATIO_LANDSCAPE", supports_images: true, min_images: 1, max_images: 2 },
  "veo_3_1_i2v_s_portrait":                       { type: "video", video_type: "i2v", model_key: "veo_3_1_i2v_s",                                 aspect_ratio: "VIDEO_ASPECT_RATIO_PORTRAIT",  supports_images: true, min_images: 1, max_images: 2 },
  "veo_3_1_i2v_s_landscape":                      { type: "video", video_type: "i2v", model_key: "veo_3_1_i2v_s",                                 aspect_ratio: "VIDEO_ASPECT_RATIO_LANDSCAPE", supports_images: true, min_images: 1, max_images: 2 },
  "veo_3_1_i2v_lite_portrait":                    { type: "video", video_type: "i2v", model_key: "veo_3_1_i2v_lite",                              aspect_ratio: "VIDEO_ASPECT_RATIO_PORTRAIT",  supports_images: true, min_images: 1, max_images: 1, use_v2_model_config: true, allow_tier_upgrade: false },
  "veo_3_1_i2v_lite_landscape":                   { type: "video", video_type: "i2v", model_key: "veo_3_1_i2v_lite",                              aspect_ratio: "VIDEO_ASPECT_RATIO_LANDSCAPE", supports_images: true, min_images: 1, max_images: 1, use_v2_model_config: true, allow_tier_upgrade: false },
  "veo_3_1_interpolation_lite_portrait":          { type: "video", video_type: "i2v", model_key: "veo_3_1_interpolation_lite",                    aspect_ratio: "VIDEO_ASPECT_RATIO_PORTRAIT",  supports_images: true, min_images: 2, max_images: 2, use_v2_model_config: true, allow_tier_upgrade: false },
  "veo_3_1_interpolation_lite_landscape":         { type: "video", video_type: "i2v", model_key: "veo_3_1_interpolation_lite",                    aspect_ratio: "VIDEO_ASPECT_RATIO_LANDSCAPE", supports_images: true, min_images: 2, max_images: 2, use_v2_model_config: true, allow_tier_upgrade: false },

  // ---- Video: R2V (reference images) ----
  "veo_3_1_r2v_fast_portrait":               { type: "video", video_type: "r2v", model_key: "veo_3_1_r2v_fast_portrait",               aspect_ratio: "VIDEO_ASPECT_RATIO_PORTRAIT",  supports_images: true, min_images: 0, max_images: 3 },
  "veo_3_1_r2v_fast":                        { type: "video", video_type: "r2v", model_key: "veo_3_1_r2v_fast_landscape",              aspect_ratio: "VIDEO_ASPECT_RATIO_LANDSCAPE", supports_images: true, min_images: 0, max_images: 3 },
  "veo_3_1_r2v_fast_portrait_ultra":         { type: "video", video_type: "r2v", model_key: "veo_3_1_r2v_fast_portrait_ultra",         aspect_ratio: "VIDEO_ASPECT_RATIO_PORTRAIT",  supports_images: true, min_images: 0, max_images: 3 },
  "veo_3_1_r2v_fast_ultra":                  { type: "video", video_type: "r2v", model_key: "veo_3_1_r2v_fast_landscape_ultra",        aspect_ratio: "VIDEO_ASPECT_RATIO_LANDSCAPE", supports_images: true, min_images: 0, max_images: 3 },
  "veo_3_1_r2v_fast_portrait_ultra_relaxed": { type: "video", video_type: "r2v", model_key: "veo_3_1_r2v_fast_portrait_ultra_relaxed", aspect_ratio: "VIDEO_ASPECT_RATIO_PORTRAIT",  supports_images: true, min_images: 0, max_images: 3 },
  "veo_3_1_r2v_fast_ultra_relaxed":          { type: "video", video_type: "r2v", model_key: "veo_3_1_r2v_fast_landscape_ultra_relaxed", aspect_ratio: "VIDEO_ASPECT_RATIO_LANDSCAPE", supports_images: true, min_images: 0, max_images: 3 },
};

export function listModels(): { id: string; entry: ModelEntry }[] {
  return Object.entries(MODEL_CONFIG).map(([id, entry]) => ({ id, entry }));
}

export function getModel(id: string): ModelEntry {
  const entry = MODEL_CONFIG[id];
  if (!entry) throw new Error(`Unknown model: ${id}`);
  return entry;
}
