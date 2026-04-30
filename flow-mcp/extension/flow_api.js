// Auth-oracle role only.
//
// The extension no longer issues Flow API calls. Its only responsibilities are:
//   1) get_auth_context  -> mint/cache the labs.google access token, export
//      cookies, browser UA, and discover the reCAPTCHA siteKey.
//   2) get_recaptcha_token -> run grecaptcha.enterprise.execute() inside a real
//      labs.google tab (the only step that genuinely requires the browser).
//
// The Node bridge then calls aisandbox-pa.googleapis.com directly with forged
// Origin/Referer/Cookie/User-Agent headers.

const LABS_BASE = "https://labs.google/fx/api";
const FLOW_PROJECT_URL_PREFIX = "https://labs.google/fx/tools/flow/project/";
const FLOW_DASHBOARD_URL = "https://labs.google/fx/tools/flow";

/** @type {{token: string, expiresAt: number} | null} */
let cachedAT = null;
/** @type {string | null} */
let cachedSiteKey = null;

async function getAccessToken() {
  if (cachedAT && Date.now() < cachedAT.expiresAt - 60_000) return cachedAT;
  const r = await fetch(`${LABS_BASE}/auth/session`, {
    method: "GET",
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`auth/session failed: ${r.status}`);
  const j = await r.json();
  if (!j?.access_token) {
    throw new Error("auth/session: missing access_token. Are you logged in to https://labs.google?");
  }
  const expiresAt = j.expires ? Date.parse(j.expires) : Date.now() + 30 * 60_000;
  cachedAT = { token: j.access_token, expiresAt };
  return cachedAT;
}

// Read every cookie a real Chrome browser would attach to a request to
// https://labs.google or https://aisandbox-pa.googleapis.com (Google sets most
// auth cookies on `.google.com`).
async function getCookieHeader() {
  const domains = [".google.com", ".labs.google", "labs.google"];
  const seen = new Map(); // name -> value (later domains override only if missing)
  for (const domain of domains) {
    let cookies;
    try {
      cookies = await chrome.cookies.getAll({ domain });
    } catch {
      continue;
    }
    for (const c of cookies) {
      // skip host-only cookies that don't apply to labs.google
      if (c.hostOnly && c.domain !== "labs.google") continue;
      if (!seen.has(c.name)) seen.set(c.name, c.value);
    }
  }
  return Array.from(seen.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
}

async function findAnyLabsTab() {
  const tabs = await chrome.tabs.query({ url: `${FLOW_PROJECT_URL_PREFIX}*` });
  if (tabs[0]) return tabs[0];
  const labsTabs = await chrome.tabs.query({ url: "https://labs.google/*" });
  if (labsTabs[0]) return labsTabs[0];
  const tab = await chrome.tabs.create({ url: FLOW_DASHBOARD_URL, active: false });
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

async function findOrOpenProjectTab(projectId) {
  if (!projectId) return findAnyLabsTab();
  const url = `${FLOW_PROJECT_URL_PREFIX}${projectId}`;
  const tabs = await chrome.tabs.query({ url: `${FLOW_PROJECT_URL_PREFIX}*` });
  let tab = tabs.find((t) => t.url && t.url.includes(projectId));
  if (!tab) {
    tab = await chrome.tabs.create({ url, active: false });
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

async function discoverSiteKey() {
  if (cachedSiteKey) return cachedSiteKey;
  const tab = await findAnyLabsTab();
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    func: async () => {
      const start = Date.now();
      while (!(window.grecaptcha && window.grecaptcha.enterprise)) {
        if (Date.now() - start > 15000) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      try {
        const cfgClients = window.___grecaptcha_cfg?.clients;
        if (cfgClients) {
          const first = Object.values(cfgClients)[0];
          if (first) {
            const k1 = Object.keys(first)[0];
            const sub1 = first[k1];
            const k2 = Object.keys(sub1)[0];
            const sub2 = sub1[k2];
            if (sub2?.sitekey) return sub2.sitekey;
          }
        }
      } catch {}
      const dataAttr = document.querySelector("[data-sitekey]")?.getAttribute("data-sitekey");
      if (dataAttr) return dataAttr;
      const scriptEl = document.querySelector('script[src*="recaptcha/enterprise.js?render="]');
      if (scriptEl) {
        const m = scriptEl.src.split("render=")[1]?.split("&")[0];
        if (m) return m;
      }
      return null;
    },
  });
  if (result) cachedSiteKey = result;
  return cachedSiteKey;
}

async function getAuthContext() {
  const at = await getAccessToken();
  const cookieHeader = await getCookieHeader();
  const userAgent = navigator.userAgent;
  let siteKey = null;
  try { siteKey = await discoverSiteKey(); } catch {}
  return {
    accessToken: at.token,
    expiresAt: at.expiresAt,
    cookieHeader,
    userAgent,
    siteKey,
  };
}

async function getRecaptchaToken({ projectId, action }) {
  const tab = await findOrOpenProjectTab(projectId);
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    args: [action],
    func: async (act) => {
      const start = Date.now();
      while (!(window.grecaptcha && window.grecaptcha.enterprise && window.grecaptcha.enterprise.execute)) {
        if (Date.now() - start > 15000) return { ok: false, error: "grecaptcha not loaded" };
        await new Promise((r) => setTimeout(r, 200));
      }
      const siteKey =
        (() => {
          try {
            const cfgClients = window.___grecaptcha_cfg?.clients;
            if (!cfgClients) return null;
            const first = Object.values(cfgClients)[0];
            if (!first) return null;
            const k1 = Object.keys(first)[0];
            const sub1 = first[k1];
            const k2 = Object.keys(sub1)[0];
            return sub1[k2]?.sitekey || null;
          } catch { return null; }
        })() ||
        document.querySelector("[data-sitekey]")?.getAttribute("data-sitekey") ||
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
  return { token: result.token };
}

export const ops = {
  get_auth_context: getAuthContext,
  get_recaptcha_token: (params) => getRecaptchaToken(params || {}),
};
