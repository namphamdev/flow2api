// Flow API client running inside the Chrome extension service worker.
// All requests are issued from the extension origin with `credentials: "include"`,
// which means Chrome attaches the user's real labs.google cookies. AT is fetched
// from /fx/api/auth/session (same as flow2api's st_to_at), then cached in memory.

const LABS_BASE = "https://labs.google/fx/api";
const API_BASE = "https://aisandbox-pa.googleapis.com/v1";

const FLOW_PROJECT_URL_PREFIX = "https://labs.google/fx/tools/flow/project/";

/** @type {{token: string, expiresAt: number} | null} */
let cachedAT = null;

async function getAccessToken() {
  if (cachedAT && Date.now() < cachedAT.expiresAt - 60_000) return cachedAT.token;
  const r = await fetch(`${LABS_BASE}/auth/session`, {
    method: "GET",
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`auth/session failed: ${r.status}`);
  const j = await r.json();
  if (!j?.access_token) throw new Error("auth/session: missing access_token. Are you logged in to https://labs.google?");
  const expiresAt = j.expires ? Date.parse(j.expires) : Date.now() + 30 * 60_000;
  cachedAT = { token: j.access_token, expiresAt };
  return j.access_token;
}

async function trpc(name, payload) {
  const url = `${LABS_BASE}/trpc/${name}`;
  const r = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ json: payload }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`trpc ${name} ${r.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

async function api(path, body, { method = "POST" } = {}) {
  const at = await getAccessToken();
  const r = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: "include",
    headers: {
      Authorization: `Bearer ${at}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  const text = await r.text();
  if (!r.ok) {
    if (r.status === 401) cachedAT = null;
    throw new Error(`api ${path} ${r.status}: ${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : {};
}

function generateSessionId() {
  return crypto.randomUUID();
}

// ---------- reCAPTCHA via the user's own labs.google tab ----------
// We open or reuse a tab on the project page (where grecaptcha is loaded normally
// for that user) and execute grecaptcha.enterprise.execute() in-page. This is the
// exact same call the page itself makes - no bypass, no third-party solver.

async function findOrOpenProjectTab(projectId) {
  const url = `${FLOW_PROJECT_URL_PREFIX}${projectId}`;
  const tabs = await chrome.tabs.query({ url: `${FLOW_PROJECT_URL_PREFIX}*` });
  let tab = tabs.find((t) => t.url && t.url.includes(projectId));
  if (!tab) {
    tab = await chrome.tabs.create({ url, active: false });
    // wait until DOM ready
    await new Promise((resolve) => {
      const listener = (tabId, info) => {
        if (tabId === tab.id && info.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
  }
  return tab;
}

// Run a fetch() inside the labs.google project tab (MAIN world) so the browser
// automatically attaches Origin: https://labs.google and Referer: https://labs.google/.
// The aisandbox-pa.googleapis.com edge rejects access tokens issued for labs.google
// when the request comes from any other origin (returns the Google "Sorry..." 403 HTML).
async function findAnyProjectTab() {
  const tabs = await chrome.tabs.query({ url: `${FLOW_PROJECT_URL_PREFIX}*` });
  if (tabs[0]) return tabs[0];
  // Fallback: any labs.google tab works for Origin/Referer purposes.
  const labsTabs = await chrome.tabs.query({ url: "https://labs.google/*" });
  if (labsTabs[0]) return labsTabs[0];
  // Last resort: open the Flow dashboard in a background tab.
  const tab = await chrome.tabs.create({ url: "https://labs.google/fx/tools/flow", active: false });
  await new Promise((resolve) => {
    const listener = (tabId, info) => {
      if (tabId === tab.id && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
  return tab;
}

async function pageFetch(projectId, { url, method = "POST", headers = {}, body }) {
  const tab = projectId
    ? await findOrOpenProjectTab(projectId)
    : (await findAnyProjectTab());
  if (!tab) throw new Error("pageFetch: no labs.google tab available");
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    args: [{ url, method, headers, body }],
    func: async ({ url, method, headers, body }) => {
      try {
        const r = await fetch(url, {
          method,
          credentials: "include",
          headers,
          body: method === "GET" ? undefined : body,
        });
        const text = await r.text();
        return { ok: r.ok, status: r.status, text };
      } catch (e) {
        return { ok: false, status: 0, text: String(e?.message || e) };
      }
    },
  });
  if (!result) throw new Error("pageFetch: no result from executeScript");
  if (!result.ok) {
    throw new Error(`api ${url} ${result.status}: ${String(result.text).slice(0, 400)}`);
  }
  return result.text ? JSON.parse(result.text) : {};
}

// Convenience wrapper that mirrors `api()` but routes through the labs.google page.
async function apiViaPage(projectId, path, body, { method = "POST" } = {}) {
  const at = await getAccessToken();
  return pageFetch(projectId, {
    url: `${API_BASE}${path}`,
    method,
    headers: {
      Authorization: `Bearer ${at}`,
      // Match the real browser request exactly: text/plain avoids CORS preflight
      // and is what the labs.google web app sends.
      "Content-Type": "text/plain;charset=UTF-8",
      Accept: "*/*",
    },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
}

async function getRecaptchaToken(projectId, action) {
  const tab = await findOrOpenProjectTab(projectId);
  // ask the page for a token
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    args: [action],
    func: async (act) => {
      // wait up to 15s for grecaptcha.enterprise to initialise
      const start = Date.now();
      while (!(window.grecaptcha && window.grecaptcha.enterprise && window.grecaptcha.enterprise.execute)) {
        if (Date.now() - start > 15000) return { ok: false, error: "grecaptcha not loaded" };
        await new Promise((r) => setTimeout(r, 200));
      }
      // discover sitekey from a rendered widget or window config
      const siteKey =
        (window.___grecaptcha_cfg && Object.keys(window.___grecaptcha_cfg.clients || {}).length
          ? Object.values(window.___grecaptcha_cfg.clients)[0]?.[Object.keys(Object.values(window.___grecaptcha_cfg.clients)[0])[0]]?.[Object.keys(Object.values(window.___grecaptcha_cfg.clients)[0][Object.keys(Object.values(window.___grecaptcha_cfg.clients)[0])[0]])[0]]?.sitekey
          : null) ||
        document.querySelector("[data-sitekey]")?.getAttribute("data-sitekey") ||
        // fallback: scan first <script src="...recaptcha/enterprise.js?render=KEY">
        (document.querySelector('script[src*="recaptcha/enterprise.js?render="]')?.src.split("render=")[1]?.split("&")[0]) ||
        null;
      if (!siteKey) return { ok: false, error: "could not locate reCAPTCHA sitekey" };
      try {
        const token = await window.grecaptcha.enterprise.execute(siteKey, { action: act });
        return { ok: true, token };
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }
    },
  });
  if (!result?.ok) throw new Error(`recaptcha failed: ${result?.error}`);
  return result.token;
}

// ---------- High-level operations ----------
export const ops = {
  async get_credits() {
    return api("/credits", undefined, { method: "GET" });
  },

  async list_projects() {
    return trpc("project.listProjects", {});
  },

  async create_project({ title }) {
    const r = await trpc("project.createProject", { projectTitle: title, toolName: "PINHOLE" });
    const projectId =
      r?.result?.data?.json?.result?.projectId ||
      r?.result?.data?.json?.projectId;
    if (!projectId) throw new Error(`createProject: missing projectId in ${JSON.stringify(r).slice(0, 200)}`);
    return { projectId };
  },

  async delete_project({ projectId }) {
    await trpc("project.deleteProject", { projectToDeleteId: projectId });
    return { ok: true };
  },

  async upload_image({ projectId, imageBase64, mimeType = "image/jpeg", aspectRatio = "IMAGE_ASPECT_RATIO_LANDSCAPE" }) {
    const fileName = `flow-mcp_${Date.now()}.${mimeType.includes("png") ? "png" : "jpg"}`;
    const clientContext = { tool: "PINHOLE" };
    if (projectId) clientContext.projectId = projectId;
    try {
      const r = await api("/flow/uploadImage", {
        clientContext,
        fileName,
        imageBytes: imageBase64,
        isHidden: false,
        isUserUploaded: true,
        mimeType,
      });
      const mediaId = r?.media?.name || r?.mediaGenerationId?.mediaGenerationId;
      if (mediaId) return { mediaId };
      throw new Error(`upload_image: no mediaId, keys=${Object.keys(r).join(",")}`);
    } catch (e) {
      if (projectId) throw e; // don't fall back when project-scoped
      const r = await api(":uploadUserImage".replace(":", "/").replace("/uploadUserImage", ":uploadUserImage"), {
        imageInput: { rawImageBytes: imageBase64, mimeType, isUserUploaded: true, aspectRatio },
        clientContext: { sessionId: generateSessionId(), tool: "ASSET_MANAGER" },
      });
      const mediaId = r?.mediaGenerationId?.mediaGenerationId || r?.media?.name;
      if (!mediaId) throw new Error(`legacy upload_image: no mediaId`);
      return { mediaId };
    }
  },

  async generate_image({ projectId, prompt, modelName, aspectRatio, upsample, imageInputs }) {
    const recaptchaToken = await getRecaptchaToken(projectId, "IMAGE_GENERATION");
    const sessionId = `;${Date.now()}`;
    const clientContext = {
      recaptchaContext: { token: recaptchaToken, applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB" },
      projectId,
      tool: "PINHOLE",
      sessionId,
    };
    const requestData = {
      clientContext,
      imageModelName: modelName,
      imageAspectRatio: aspectRatio,
      structuredPrompt: { parts: [{ text: prompt }] },
      seed: Math.floor(Math.random() * 999999) + 1,
      imageInputs: imageInputs || [],
    };
    const r = await apiViaPage(projectId, `/projects/${projectId}/flowMedia:batchGenerateImages`, {
      clientContext,
      mediaGenerationContext: { batchId: crypto.randomUUID() },
      useNewMedia: true,
      requests: [requestData],
    });
    if (upsample) {
      // chained 2K/4K upsample
      const generated =
        r?.imagePanels?.[0]?.generatedImages ||
        r?.images ||
        [];
      if (generated[0]) {
        const mediaId = generated[0]?.mediaGenerationId || generated[0]?.media?.name;
        if (mediaId) {
          const up = await apiViaPage(projectId, "/flow/upsampleImage", {
            clientContext,
            mediaGenerationId: mediaId,
            resolution: typeof upsample === "string" ? upsample : upsample.resolution,
          });
          return { generation: r, upsample: up };
        }
      }
    }
    return { generation: r };
  },

  async generate_video({
    projectId, prompt, videoType, modelKey, aspectRatio, imageInputs, useV2ModelConfig, upsample, userPaygateTier,
  }) {
    const recaptchaToken = await getRecaptchaToken(projectId, "VIDEO_GENERATION");
    const sessionId = `;${Date.now()}`;
    const sceneId = crypto.randomUUID();
    const clientContext = {
      recaptchaContext: { token: recaptchaToken, applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB" },
      projectId,
      tool: "PINHOLE",
      sessionId,
      userPaygateTier: userPaygateTier || "PAYGATE_TIER_ONE",
    };

    const buildText = () => {
      if (useV2ModelConfig) return undefined; // moved into structuredPrompt
      return prompt;
    };

    let url, requestData;
    if (videoType === "t2v") {
      url = "/video:batchAsyncGenerateVideoText";
      requestData = {
        aspectRatio,
        seed: Math.floor(Math.random() * 99999) + 1,
        videoModelKey: modelKey,
        metadata: { sceneId },
        ...(useV2ModelConfig
          ? { structuredPrompt: { parts: [{ text: prompt }] } }
          : { textInput: { prompt } }),
      };
    } else if (videoType === "i2v") {
      // start frame (and optional end frame)
      const first = imageInputs.find((i) => i.role === "first") || imageInputs[0];
      const last = imageInputs.find((i) => i.role === "last") || (imageInputs.length === 2 ? imageInputs[1] : null);
      if (last) {
        url = "/video:batchAsyncGenerateVideoStartAndEndImage";
        requestData = {
          aspectRatio,
          seed: Math.floor(Math.random() * 99999) + 1,
          videoModelKey: modelKey,
          metadata: { sceneId },
          startImage: { mediaId: first.mediaId },
          endImage: { mediaId: last.mediaId },
          ...(useV2ModelConfig
            ? { structuredPrompt: { parts: [{ text: prompt }] } }
            : { textInput: { prompt } }),
        };
      } else {
        url = "/video:batchAsyncGenerateVideoStartImage";
        requestData = {
          aspectRatio,
          seed: Math.floor(Math.random() * 99999) + 1,
          videoModelKey: modelKey,
          metadata: { sceneId },
          startImage: { mediaId: first.mediaId },
          ...(useV2ModelConfig
            ? { structuredPrompt: { parts: [{ text: prompt }] } }
            : { textInput: { prompt } }),
        };
      }
    } else if (videoType === "r2v") {
      url = "/video:batchAsyncGenerateVideoReferenceImages";
      requestData = {
        aspectRatio,
        seed: Math.floor(Math.random() * 99999) + 1,
        videoModelKey: modelKey,
        metadata: { sceneId },
        referenceImages: (imageInputs || []).map((i) => ({
          imageUsageType: "IMAGE_USAGE_TYPE_ASSET",
          mediaId: i.mediaId,
        })),
        ...(useV2ModelConfig
          ? { structuredPrompt: { parts: [{ text: prompt }] } }
          : { textInput: { prompt } }),
      };
    } else {
      throw new Error(`unknown videoType ${videoType}`);
    }

    const body = {
      clientContext,
      requests: [requestData],
      ...(useV2ModelConfig ? { useV2ModelConfig: true, mediaGenerationContext: { batchId: crypto.randomUUID() } } : {}),
    };
    const r = await apiViaPage(projectId, url, body);
    return { ...r, _upsample: upsample || null };
  },

  async poll_video({ operations }) {
    return apiViaPage(null, "/video:batchCheckAsyncVideoGenerationStatus", { operations });
  },

  async wait_video({ operations, timeoutMs = 25 * 60_000 }, sendProgress) {
    const start = Date.now();
    let ops = operations;
    let interval = 5000;
    while (true) {
      if (Date.now() - start > timeoutMs) throw new Error("wait_video timed out");
      const r = await apiViaPage(null, "/video:batchCheckAsyncVideoGenerationStatus", { operations: ops });
      const list = r?.operations || [];
      const allDone = list.every((o) => {
        const s = o?.status || o?.operation?.metadata?.status;
        return s && s !== "MEDIA_GENERATION_STATUS_PENDING" && s !== "MEDIA_GENERATION_STATUS_RUNNING";
      });
      if (sendProgress) {
        const summary = list.map((o) => `${o?.operation?.name?.split("/").pop()}=${o?.status}`).join(", ");
        sendProgress(`status: ${summary}`);
      }
      if (allDone) return r;
      ops = list.map((o) => ({
        operation: { name: o?.operation?.name },
        sceneId: o?.sceneId,
        status: o?.status,
      }));
      await new Promise((res) => setTimeout(res, interval));
      interval = Math.min(interval + 1000, 15000);
    }
  },
};
