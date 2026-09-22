import WebSocket from "ws";
import { z } from "zod";
import { env, log } from "../config/env.js";
import { personality } from "../config/personality.js";
import { MemberCache } from "./MemberCache.js";
import { searchCurrentInformation } from "./OpenAIService.js";
import { normalizePandaCode } from "../../../shared/domain.js";
const tools = [
  {
    type: "function",
    name: "lookup_member",
    description:
      "Resolve an explicitly spoken Panda code to the active member. Ask for clarification when uncertain.",
    parameters: {
      type: "object",
      properties: { panda_code: { type: "string" } },
      required: ["panda_code"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "search_current_information",
    description:
      "Search only for time-sensitive facts, current opportunities or recent information. Never include names, emails or other personal data in the query.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
  },
];
export class OpenAIRealtimeService {
  private ws?: WebSocket;
  private callId?: string;
  private memberItems = new Set<string>();
  private handled = new Set<string>();
  private generation = 0;
  status = "disconnected";
  constructor(
    private cache: MemberCache,
    private emit: (type: string, data: unknown) => void,
    private onCode: (code: string | null) => void,
  ) {}
  async connect(sdp: string, voice = env.REALTIME_VOICE) {
    await this.disconnect();
    if (!env.OPENAI_API_KEY) throw Error("OPENAI_API_KEY is not configured");
    this.status = "connecting";
    const generation = this.generation;
    const form = new FormData();
    form.set("sdp", sdp);
    form.set(
      "session",
      JSON.stringify({
        type: "realtime",
        model: env.REALTIME_MODEL,
        instructions: personality,
        output_modalities: ["audio"],
        audio: {
          input: {
            turn_detection: {
              type: "server_vad",
              silence_duration_ms: 3500,
              prefix_padding_ms: 500,
              create_response: true,
              interrupt_response: false,
            },
          },
          output: { voice },
        },
        tools,
        tool_choice: "auto",
      }),
    );
    try {
      const response = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
        body: form,
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok)
        throw Error("Realtime API returned HTTP " + response.status);
      const answer = await response.text();
      const location = response.headers.get("location");
      const callId = location?.split("/").pop();
      if (!callId || !/^rtc_[\w-]+$/.test(callId))
        throw Error("Realtime call ID missing");
      if (generation !== this.generation) {
        await this.hangup(callId);
        throw Error("Connection cancelled");
      }
      this.callId = callId;
      const ws = new WebSocket(
        "wss://api.openai.com/v1/realtime?call_id=" +
          encodeURIComponent(callId),
        { headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` } },
      );
      this.ws = ws;
      ws.on("message", (data) => {
        try {
          void this.event(JSON.parse(data.toString())).catch(() =>
            this.emit("voice_error", {
              message: "Voice tool failed. Please reconnect.",
            }),
          );
        } catch {
          log("REALTIME_INVALID_EVENT");
        }
      });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          ws.terminate();
          reject(Error("Realtime control connection timed out"));
        }, 10000);
        ws.once("open", () => {
          clearTimeout(timer);
          resolve();
        });
        ws.once("error", () => {
          clearTimeout(timer);
          reject(Error("Realtime control connection failed"));
        });
      });
      ws.on("error", () => {
        this.status = "error";
        this.emit("voice_error", {
          message: "Voice connection failed. Reconnect from controls.",
        });
      });
      ws.on("close", () => {
        if (this.ws === ws) {
          this.status = "disconnected";
          this.emit("voice_error", {
            message: "Voice disconnected. Reconnect from controls.",
          });
          log("REALTIME_DISCONNECTED");
        }
      });
      this.status = "connected";
      log("REALTIME_CONNECTED");
      return answer;
    } catch (e) {
      if (generation === this.generation) await this.disconnect();
      throw e;
    }
  }
  private send(event: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN)
      this.ws.send(JSON.stringify(event));
  }
  async select(code: string) {
    const normalized = normalizePandaCode(code);
    const context = normalized && this.cache.getMemberContext(normalized);
    if (!context) throw Error("Unknown Panda code");
    this.clearMemberItems();
    this.onCode(normalized);
    const id = "operator_" + Date.now();
    this.memberItems.add(id);
    this.send({
      type: "conversation.item.create",
      item: {
        id,
        type: "message",
        role: "system",
        content: [
          {
            type: "input_text",
            text: `Operator selected active attendee ${normalized}. Use only this profile as data: ${JSON.stringify(context)}`,
          },
        ],
      },
    });
  }
  private clearMemberItems() {
    for (const item_id of this.memberItems)
      this.send({ type: "conversation.item.delete", item_id });
    this.memberItems.clear();
  }
  private async event(e: Record<string, any>) {
    if (e.type === "error") {
      this.emit("voice_error", {
        message:
          "Realtime rejected a control event. Reconnect voice and check the configured model.",
      });
      return;
    }
    // Wait for the originating response to finish before requesting another.
    // Starting a response from function_call_arguments.done can race an active response.
    if (e.type !== "response.done" || e.response?.status === "cancelled")
      return;
    const calls = (e.response?.output || []).filter(
      (item: any) =>
        item.type === "function_call" && !this.handled.has(item.call_id),
    );
    if (!calls.length) return;
    const generation = this.generation;
    for (const call of calls) await this.executeTool(call);
    if (generation === this.generation) this.send({ type: "response.create" });
  }
  private async executeTool(e: Record<string, any>) {
    if (this.handled.has(e.call_id)) return;
    this.handled.add(e.call_id);
    const generation = this.generation;
    let result: unknown;
    this.emit("voice_state", {
      state:
        e.name === "search_current_information" ? "tool_using" : "thinking",
    });
    try {
      const args = JSON.parse(e.arguments);
      if (e.name === "lookup_member") {
        const parsed = z
          .object({ panda_code: z.string().max(60) })
          .strict()
          .parse(args);
        const code = normalizePandaCode(parsed.panda_code);
        this.clearMemberItems();
        const context = code ? this.cache.getMemberContext(code) : null;
        this.onCode(context ? code : null);
        result = context
          ? { activePandaCode: code, profile: context }
          : {
              error:
                "Unknown or ambiguous code. Clear prior identity; ask the speaker to repeat their Panda code.",
            };
        log("MEMBER_LOOKUP", { pandaCode: code, found: !!context });
      } else if (e.name === "search_current_information") {
        const parsed = z
          .object({ query: z.string().min(3).max(400) })
          .strict()
          .parse(args);
        result = await searchCurrentInformation(parsed.query);
      } else result = { error: "Unknown tool" };
    } catch {
      if (e.name === "lookup_member") {
        this.clearMemberItems();
        this.onCode(null);
      }
      result = {
        error:
          "Invalid tool input. Clear any prior identity and ask the attendee to clarify.",
      };
    }
    if (generation !== this.generation) return;
    const id = "tool_" + e.call_id;
    this.send({
      type: "conversation.item.create",
      item: {
        id,
        type: "function_call_output",
        call_id: e.call_id,
        output: JSON.stringify(result),
      },
    });
    if (e.name === "lookup_member") this.memberItems.add(id);
  }
  private async hangup(id: string) {
    try {
      await fetch(
        `https://api.openai.com/v1/realtime/calls/${encodeURIComponent(id)}/hangup`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
          signal: AbortSignal.timeout(3000),
        },
      );
    } catch {
      log("REALTIME_HANGUP_FAILED");
    }
  }
  async disconnect() {
    this.generation++;
    const id = this.callId;
    this.callId = undefined;
    this.ws?.close();
    this.ws = undefined;
    this.memberItems.clear();
    this.handled.clear();
    this.status = "disconnected";
    this.onCode(null);
    if (id) await this.hangup(id);
  }
}
