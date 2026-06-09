import { StreamableHTTPTransport } from "@hono/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createEoaStageWriter } from "@sonara/onchain";
import type { StageKnob } from "@sonara/onchain";
import type { Context } from "hono";
import type { Address, Hex } from "viem";
import { z } from "zod";

import type { Logger } from "../lib/logger";
import { stageRooms } from "./stage-rooms";
import { stageState } from "./stage-state";

// MCP server: lets an AI agent (e.g. Claude Code) VJ a live Sonara session by
// emitting the SAME on-chain SonaraStage txs the audience does — the agent is
// just another participant on the chain control plane. Tools are signed by the
// server-held agent EOA (MCP_AGENT_KEY), which pays its own testnet gas; the
// room code is the capability (no extra auth, same as the audience page).
//
// Mounted on Hono at /api/mcp via @hono/mcp's StreamableHTTPTransport. Stateless
// (a fresh McpServer per request, invok's pattern); the EOA writer — and its
// local nonce counter — is shared across requests so rapid agent calls don't
// collide on nonces.

const NUDGE_KNOBS = ["softness", "surrealness", "abstraction", "stability"] as const;

const text = (body: string) => ({
  content: [{ text: body, type: "text" as const }],
});

export const createStageMcp = (opts: {
  contract: Address;
  agentKey: Hex;
  logger: Logger;
}): ((c: Context) => Promise<Response>) => {
  const writer = createEoaStageWriter({
    contract: opts.contract,
    privateKey: opts.agentKey,
  });

  const buildServer = (): McpServer => {
    const server = new McpServer({ name: "sonara-stage", version: "1.0.0" });

    server.registerTool(
      "sonara_snapshot",
      {
        description:
          "Read a stage room's live state: whether it's open, the on-chain tap count, the prompt now playing on the projector, and the up-next queue. Call this first to see what's on screen.",
        inputSchema: { room: z.string().describe("the stage room code, e.g. ABCDE") },
      },
      ({ room }) => {
        const s = stageState.get(room);
        return text(
          JSON.stringify(
            {
              nowPlaying: s.nowPlaying,
              open: Boolean(stageRooms.resolve(room)),
              txCount: s.txCount,
              upNext: s.upNext,
            },
            null,
            2
          )
        );
      }
    );

    server.registerTool(
      "sonara_set_intensity",
      {
        description:
          "Set how alive the visuals are — i.e. how often a new frame is generated. 0 = calm slideshow (~6s), 1 = fast live stream (~2s). Also drives the audio-reactive shader. Sends an on-chain Monad tx.",
        inputSchema: {
          room: z.string(),
          value: z.number().min(0).max(1).describe("0..1 intensity level"),
        },
      },
      async ({ room, value }) => {
        const tx = await writer.set(room, "intensity", value);
        return text(`intensity → ${value} (tx ${tx})`);
      }
    );

    server.registerTool(
      "sonara_nudge",
      {
        description:
          "Nudge a look knob by a relative step. softness (soft↔sharp), surrealness (real↔dreamlike), abstraction (literal↔abstract), stability (morphing↔steady). Positive = more of it. Sends an on-chain Monad tx.",
        inputSchema: {
          delta: z.number().min(-1).max(1).describe("relative step, e.g. 0.15"),
          knob: z.enum(NUDGE_KNOBS),
          room: z.string(),
        },
      },
      async ({ room, knob, delta }) => {
        const tx = await writer.nudge(room, knob as StageKnob, delta);
        return text(`${knob} ${delta >= 0 ? "+" : ""}${delta} (tx ${tx})`);
      }
    );

    server.registerTool(
      "sonara_prompt",
      {
        description:
          "Submit a scene prompt to the room's queue (e.g. 'neon jellyfish drifting over a rain-soaked city'). It takes the projector for its turn in the queue. Sends an on-chain Monad tx.",
        inputSchema: {
          room: z.string(),
          text: z.string().min(1).max(200).describe("the scene to render"),
        },
      },
      async ({ room, text: prompt }) => {
        const tx = await writer.prompt(room, prompt);
        return text(`queued "${prompt}" (tx ${tx})`);
      }
    );

    return server;
  };

  return async (c: Context): Promise<Response> => {
    const server = buildServer();
    const transport = new StreamableHTTPTransport();
    await server.connect(transport);
    const res = await transport.handleRequest(c);
    return res ?? c.body(null, 500);
  };
};
