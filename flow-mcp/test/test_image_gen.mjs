// Standalone test script — connects directly to the bridge WS and exercises:
//   1. Text-to-image generation (prompt only)
//   2. Image-to-image generation (prompt + reference image)
//
// Prerequisites:
//   - Bridge running:  node flow-mcp/bridge/dist/index.js
//   - Chrome extension connected and logged in to labs.google
//
// Usage:
//   node flow-mcp/test/test_image_gen.mjs [--project <id>]
//
// If --project is omitted the script creates a temporary project and deletes it at the end.

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const WebSocket = require("../bridge/node_modules/ws");
import fs from "node:fs";
import path from "node:path";

const HOST = process.env.FLOW_MCP_HOST || "127.0.0.1";
const PORT = Number(process.env.FLOW_MCP_PORT || 39999);
const WS_URL = `ws://${HOST}:${PORT}/`;

// A tiny 8x8 red PNG (base64) used as the reference image for image-to-image test.
// Replace with a real image base64 for meaningful results.
const TINY_RED_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAADklEQVQI12P4z8BQDwAEgAF/" +
  "QualKwAAAABJRU5ErkJggg==";

// ---- helpers ----

let idCounter = 0;
function nextId() { return `test-${++idCounter}-${Date.now()}`; }

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function call(ws, op, params = {}, timeoutMs = 180_000) {
  const id = nextId();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`[${op}] timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const handler = (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.id !== id) return;
      if (msg.progress) {
        console.log(`  [progress] ${msg.message}`);
        return;
      }
      ws.removeListener("message", handler);
      clearTimeout(timer);
      if (msg.ok) resolve(msg.data);
      else reject(new Error(`[${op}] ${msg.error}`));
    };
    ws.on("message", handler);
    ws.send(JSON.stringify({ id, op, params }));
  });
}

function log(label, data) {
  console.log(`\n=== ${label} ===`);
  console.log(typeof data === "string" ? data : JSON.stringify(data, null, 2));
}

// ---- CLI args ----
const args = process.argv.slice(2);
let providedProjectId = null;
const pidx = args.indexOf("--project");
if (pidx !== -1 && args[pidx + 1]) providedProjectId = args[pidx + 1];

// ---- main ----
async function main() {
  console.log(`Connecting to bridge at ${WS_URL} ...`);
  const ws = await connect();
  console.log("Connected.\n");

  let projectId = providedProjectId;
  let createdProject = false;

  try {
    // 0. Check credits (quick connectivity test)
    const credits = await call(ws, "get_credits");
    log("Credits", credits);

    // 1. Ensure we have a project
    if (!projectId) {
      console.log("\nNo --project supplied, creating a temporary project...");
      const p = await call(ws, "create_project", { title: "flow-mcp-test" });
      projectId = p.projectId;
      createdProject = true;
      log("Created project", projectId);
    } else {
      log("Using existing project", projectId);
    }

    // -------------------------------------------------------
    // TEST 1: Text-to-image (prompt only)
    // -------------------------------------------------------
    console.log("\n--- TEST 1: Text-to-image ---");
    const t2iResult = await call(ws, "generate_image", {
      projectId,
      prompt: "A cute cat playing in a garden, studio lighting, high detail",
      modelName: "NARWHAL",
      aspectRatio: "IMAGE_ASPECT_RATIO_LANDSCAPE",
      upsample: null,
      imageInputs: [],
    });
    log("Text-to-image result", t2iResult);

    // -------------------------------------------------------
    // TEST 2: Image-to-image (prompt + reference image)
    // -------------------------------------------------------
    console.log("\n--- TEST 2: Image-to-image (prompt + reference) ---");

    // 2a. Upload reference image
    console.log("Uploading reference image...");
    const upload = await call(ws, "upload_image", {
      projectId,
      imageBase64: TINY_RED_PNG,
      mimeType: "image/png",
    });
    log("Uploaded image", upload);
    const mediaId = upload.mediaId;

    // 2b. Generate with reference
    console.log("Generating image with reference...");
    const i2iResult = await call(ws, "generate_image", {
      projectId,
      prompt: "Transform this image into a watercolor painting style",
      modelName: "NARWHAL",
      aspectRatio: "IMAGE_ASPECT_RATIO_LANDSCAPE",
      upsample: null,
      imageInputs: [{ mediaId }],
    });
    log("Image-to-image result", i2iResult);

    console.log("\n========================================");
    console.log("All tests passed!");
    console.log("========================================");

  } catch (err) {
    console.error("\nTEST FAILED:", err.message || err);
    process.exitCode = 1;
  } finally {
    // Cleanup: delete temp project if we created one
    if (createdProject && projectId) {
      try {
        console.log(`\nCleaning up: deleting project ${projectId}...`);
        await call(ws, "delete_project", { projectId });
        console.log("Project deleted.");
      } catch (e) {
        console.warn("Cleanup failed:", e.message);
      }
    }
    ws.close();
  }
}

main();
