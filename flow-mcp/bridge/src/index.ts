#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { ExtensionBridge } from "./bridge.js";
import * as flow from "./flow.js";

// ---- WS client of the Native Messaging host ----
// (the host is spawned by Chrome via chrome.runtime.connectNative and owns
// the singleton WS port that all bridge processes connect to.)
const bridge = new ExtensionBridge({});
process.stderr.write(`[flow-mcp] WS client of native host (handshake at ~/.flow-mcp-bridge.json)\n`);

// ---- MCP server ----
const server = new Server(
  { name: "flow-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

const tools = [
  {
    name: "flow_list_models",
    description: "List all Flow models supported by this bridge (image + video).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async () => flow.listKnownModels(),
  },
  {
    name: "flow_get_credits",
    description: "Return current VideoFX credits + tier for the logged-in labs.google account.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async () => flow.getCredits({ bridge }),
  },
  {
    name: "flow_list_projects",
    description: "List existing Flow projects on the logged-in account.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async () => flow.listProjects({ bridge }),
  },
  {
    name: "flow_create_project",
    description: "Create a new Flow project.",
    inputSchema: {
      type: "object",
      properties: { title: { type: "string" } },
      required: ["title"],
      additionalProperties: false,
    },
    handler: async (args: { title: string }) => flow.createProject({ bridge }, args.title),
  },
  {
    name: "flow_delete_project",
    description: "Delete a Flow project by id.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" } },
      required: ["projectId"],
      additionalProperties: false,
    },
    handler: async (args: { projectId: string }) => flow.deleteProject({ bridge }, args.projectId),
  },
  {
    name: "flow_upload_image",
    description: "Upload a base64-encoded image to Flow and return the mediaId. Use this before image-to-video / image-to-image / reference-images calls.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        imageBase64: { type: "string", description: "Raw base64, no data: prefix" },
        mimeType: { type: "string", description: "image/jpeg | image/png | image/webp", default: "image/jpeg" },
        aspectRatio: { type: "string", description: "IMAGE_ASPECT_RATIO_LANDSCAPE | IMAGE_ASPECT_RATIO_PORTRAIT | IMAGE_ASPECT_RATIO_SQUARE | ..." },
      },
      required: ["imageBase64"],
      additionalProperties: false,
    },
    handler: async (args: {
      projectId?: string;
      imageBase64: string;
      mimeType?: string;
      aspectRatio?: string;
    }) => flow.uploadImage({ bridge }, args),
  },
  {
    name: "flow_generate_image",
    description: "Generate an image (text-to-image or image-to-image when imageInputs are supplied). Returns the generated media URL(s).",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        prompt: { type: "string" },
        model: { type: "string", description: "Model id from flow_list_models, e.g. gemini-3.1-flash-image-landscape" },
        imageInputs: {
          type: "array",
          items: {
            type: "object",
            properties: { mediaId: { type: "string" } },
            required: ["mediaId"],
            additionalProperties: false,
          },
          default: [],
        },
      },
      required: ["projectId", "prompt", "model"],
      additionalProperties: false,
    },
    handler: async (args: any) => flow.generateImage({ bridge }, args),
  },
  {
    name: "flow_generate_video",
    description: "Submit a video generation job (T2V / I2V / R2V depending on the chosen model). Returns operations[] - call flow_wait_video to wait for completion.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        prompt: { type: "string" },
        model: { type: "string", description: "Model id from flow_list_models, e.g. veo_3_1_t2v_fast_landscape" },
        imageInputs: {
          type: "array",
          items: {
            type: "object",
            properties: {
              mediaId: { type: "string" },
              role: { type: "string", enum: ["first", "last", "reference"] },
            },
            required: ["mediaId"],
            additionalProperties: false,
          },
          default: [],
        },
        userPaygateTier: { type: "string", default: "PAYGATE_TIER_ONE" },
      },
      required: ["projectId", "prompt", "model"],
      additionalProperties: false,
    },
    handler: async (args: any) => flow.generateVideo({ bridge }, args),
  },
  {
    name: "flow_poll_video",
    description: "One-shot poll of a video operation list. Use flow_wait_video for the easier blocking variant.",
    inputSchema: {
      type: "object",
      properties: {
        operations: {
          type: "array",
          items: { type: "object" },
        },
      },
      required: ["operations"],
      additionalProperties: false,
    },
    handler: async (args: { operations: any[] }) => flow.pollVideo({ bridge }, args.operations),
  },
  {
    name: "flow_wait_video",
    description: "Wait for the supplied video operations to reach a terminal status (default 25min timeout). Returns the final operation payload including the video URL.",
    inputSchema: {
      type: "object",
      properties: {
        operations: { type: "array", items: { type: "object" } },
        timeoutMs: { type: "number", default: 1500000 },
      },
      required: ["operations"],
      additionalProperties: false,
    },
    handler: async (args: { operations: any[]; timeoutMs?: number }) => {
      return flow.waitVideo({ bridge }, args.operations, args.timeoutMs);
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const tool = tools.find((t) => t.name === req.params.name);
  if (!tool) throw new Error(`Unknown tool: ${req.params.name}`);
  try {
    const result = await tool.handler(req.params.arguments as any);
    return {
      content: [
        { type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) },
      ],
    };
  } catch (err: any) {
    return {
      isError: true,
      content: [{ type: "text", text: err?.message || String(err) }],
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write("[flow-mcp] MCP server ready on stdio\n");
