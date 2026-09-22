import express from "express";
import rateLimit from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { z } from "zod";
import { env, log } from "./config/env.js";
import { MemberCache } from "./services/MemberCache.js";
import { GoogleSheetsService } from "./services/GoogleSheetsService.js";
import { SheetPoller } from "./services/SheetPoller.js";
import { EnrichmentQueue } from "./services/EnrichmentQueue.js";
import { TTSService } from "./services/OpenAIService.js";
import { OpenAIRealtimeService } from "./services/OpenAIRealtimeService.js";
import {
  REALTIME_VOICES,
  TTS_VOICES,
  greetingVoices,
} from "../../shared/voices.js";
import {
  normalizePandaCode,
  type MemberProfile,
  type SignIn,
  type Arrival,
  type Controls,
} from "../../shared/domain.js";
export const app = express();
app.disable("x-powered-by");
// This application is a local operator console, never an attendee-facing server.
app.use((req, res, next) => {
  const host = (req.headers.host || "").split(":")[0];
  if (!["localhost", "127.0.0.1", "["].includes(host))
    return res.status(403).json({ error: "Local host required" });
  const origin = req.headers.origin;
  const allowed = new Set([
    env.CLIENT_URL,
    "http://127.0.0.1:5173",
    `http://localhost:${env.PORT}`,
    `http://127.0.0.1:${env.PORT}`,
  ]);
  if (origin && !allowed.has(origin))
    return res.status(403).json({ error: "Unexpected origin" });
  if (req.headers["sec-fetch-site"] === "cross-site")
    return res.status(403).json({ error: "Cross-site access denied" });
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});
app.use(
  "/api",
  rateLimit({
    windowMs: 60000,
    limit: 600,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);
app.use(express.json({ limit: "32kb" }));
const cache = new MemberCache();
const sheets = env.DEMO_MODE ? undefined : new GoogleSheetsService();
const enrichment = new EnrichmentQueue(cache, sheets);
const tts = new TTSService();
let controls: Controls = {
  greetingVoice: env.TTS_VOICE,
  responseVoice: env.REALTIME_VOICE,
  mode: "arrival",
  muted: false,
  micPaused: false,
  autoGreet: env.ENABLE_AUTO_GREET,
  forcedState: null,
  activeCode: null,
};
const clients = new Set<express.Response>();
const arrivals = new Map<string, Arrival>();
const pending = new Set<string>();
let latest: Arrival | undefined;
let owner: { id: string; until: number } | null = null;
let telemetry = {
  state: "typing",
  queue: 0,
  audioEnabled: false,
  voice: "disconnected",
  error: "",
  voiceEvent: "Not connected",
  greetingStatus: "Enable audio on the projector",
  microphoneLabel: "Not connected",
  microphones: [] as { deviceId: string; label: string }[],
  inputLevel: 0,
};
function emit(type: string, data: unknown) {
  for (const res of clients)
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}
const realtime = new OpenAIRealtimeService(cache, emit, (code) => {
  controls.activeCode = code;
  emit("controls", controls);
});
function enqueue(a: Arrival) {
  arrivals.set(a.eventId, a);
  pending.add(a.eventId);
  latest = a;
  log("GREETING_QUEUED", { eventId: a.eventId });
  emit("member_arrived", a);
}
let enrichmentReady = env.DEMO_MODE;
const poller = sheets
  ? new SheetPoller(sheets, cache, enqueue, (m) => {
      if (enrichmentReady) enrichment.enqueue(m);
    })
  : null;
function state() {
  return {
    controls,
    voiceOptions: {
      greeting: greetingVoices(env.TTS_MODEL),
      response: REALTIME_VOICES,
    },
    sessionId: env.SESSION_ID,
    sessionName: env.SESSION_NAME,
    demo: env.DEMO_MODE,
    openaiConfigured: !!env.OPENAI_API_KEY,
    memberCount: cache.membersById.size,
    attendeeCount: cache.membersByPandaCode.size,
    pendingGreetings: pending.size,
    lastSheetsSync: poller?.lastSync ?? null,
    sheetsError: poller?.lastError ?? null,
    enrichment: enrichment.status,
    voice: realtime.status,
    projectorConnected: !!owner && owner.until > Date.now(),
    telemetry,
    attendees: [...cache.membersByPandaCode].map(([code, id]) => ({
      code,
      name: cache.membersById.get(id)?.display_name,
    })),
  };
}
app.get("/api/status", (_req, res) => res.json(state()));
app.get("/api/events", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  clients.add(res);
  res.write(`event: controls\ndata: ${JSON.stringify(controls)}\n\n`);
  for (const id of pending)
    res.write(
      `event: member_arrived\ndata: ${JSON.stringify(arrivals.get(id))}\n\n`,
    );
  const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15000);
  req.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
});
const idSchema = z.object({ clientId: z.string().uuid() });
app.post("/api/projector/claim", (req, res) => {
  const { clientId } = idSchema.parse(req.body);
  if (owner && owner.until > Date.now() && owner.id !== clientId)
    return res.status(409).json({
      error: "Another projector owns audio. Close it or wait 15 seconds.",
    });
  owner = { id: clientId, until: Date.now() + 15000 };
  res.json({ ok: true });
});
function requireOwner(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  if (
    !owner ||
    owner.until < Date.now() ||
    owner.id !== req.headers["x-projector-id"]
  )
    return res.status(409).json({ error: "Projector audio lease expired" });
  next();
}
app.post("/api/projector/telemetry", requireOwner, (req, res) => {
  telemetry = z
    .object({
      state: z.string().max(40),
      queue: z.number().int().min(0),
      audioEnabled: z.boolean(),
      voice: z.string().max(60),
      error: z.string().max(200),
      microphoneLabel: z.string().max(500).default("Not connected"),
      microphones: z
        .array(
          z.object({
            deviceId: z.string().max(500),
            label: z.string().max(500),
          }),
        )
        .max(100)
        .default([]),
      inputLevel: z.number().min(0).max(1).default(0),
      voiceEvent: z
        .string()
        .max(200)
        .default("Not available — reload projector"),
      greetingStatus: z
        .string()
        .max(200)
        .default("Not available — reload projector"),
    })
    .parse(req.body);
  res.json({ ok: true });
});
app.post("/api/greeting/:id/ack", requireOwner, (req, res) => {
  pending.delete(String(req.params.id));
  log("GREETING_PLAYED", { eventId: req.params.id });
  res.json({ ok: true });
});
app.get("/api/greeting/:id/audio", async (req, res) => {
  const a = arrivals.get(String(req.params.id));
  if (!a) return res.status(404).json({ error: "Greeting not found" });
  const audio = await tts.greeting(a, controls.greetingVoice);
  res.type("audio/mpeg").send(audio);
});
app.post("/api/controls", async (req, res) => {
  const patch = z
    .object({
      mode: z.enum(["arrival", "qa"]).optional(),
      greetingVoice: z.enum(TTS_VOICES).optional(),
      responseVoice: z.enum(REALTIME_VOICES).optional(),
      microphoneId: z.string().max(500).optional(),
      muted: z.boolean().optional(),
      micPaused: z.boolean().optional(),
      autoGreet: z.boolean().optional(),
      forcedState: z
        .enum([
          "idle",
          "typing",
          "new_arrival",
          "look_up",
          "listening",
          "thinking",
          "tool_using",
          "speaking",
          "return_to_keyboard",
        ])
        .nullable()
        .optional(),
    })
    .strict()
    .parse(req.body);
  if (
    patch.greetingVoice &&
    !greetingVoices(env.TTS_MODEL).includes(patch.greetingVoice)
  )
    return res
      .status(400)
      .json({
        error: "This voice is not supported by the configured greeting model",
      });
  controls = { ...controls, ...patch };
  if (patch.mode === "arrival") await realtime.disconnect();
  emit("controls", controls);
  res.json(controls);
});
app.post("/api/admin/action", async (req, res) => {
  const { action, code } = z
    .object({
      action: z.enum([
        "clear",
        "replay",
        "reconnect",
        "refresh",
        "select",
        "end_exchange",
      ]),
      code: z.string().max(60).optional(),
    })
    .parse(req.body);
  if (action === "clear") {
    pending.clear();
    emit("command", { action });
  }
  if (action === "replay" && latest)
    enqueue({ ...latest, eventId: randomUUID() });
  if (action === "reconnect") emit("command", { action });
  if (action === "end_exchange") {
    await realtime.disconnect();
    emit("command", { action: "reconnect" });
  }
  if (action === "refresh") await poller?.refresh();
  if (action === "select") {
    const normalized = normalizePandaCode(code || "");
    if (!normalized || !cache.getMemberContext(normalized))
      return res.status(404).json({ error: "Unknown Panda code" });
    await realtime.select(normalized);
  }
  res.json({ ok: true });
});
app.post("/api/admin/simulateArrival", (req, res) => {
  if (!env.DEMO_MODE)
    return res
      .status(403)
      .json({ error: "Simulation is enabled only in DEMO_MODE" });
  const input = z
    .object({
      name: z.string().trim().min(1).max(80),
      pandaCode: z.string().max(60).optional(),
      memberId: z.string().max(80).optional(),
    })
    .parse(req.body);
  const code = normalizePandaCode(
    input.pandaCode ||
      Array.from({ length: 100 }, (_, i) => "P" + (i + 1)).find(
        (c) => !cache.membersByPandaCode.has(c),
      ) ||
      "invalid",
  );
  if (!code || cache.membersByPandaCode.has(code))
    return res
      .status(400)
      .json({ error: "Use a free Panda code from 1 to 100" });
  const memberId = input.memberId || randomUUID();
  const existing = cache.membersById.get(memberId);
  cache.upsert(
    existing || {
      member_id: memberId,
      email_normalized: "",
      display_name: input.name,
      first_name: input.name.split(" ")[0],
      github_url: "",
      github_enrichment_consent: "false",
      major: "Computer Science",
      career_interest: "AI / ML",
      current_goal: "Build a first deployed project",
      experience_level: "Intermediate",
    },
  );
  const a = cache.arrive({
    event_id: randomUUID(),
    session_id: env.SESSION_ID,
    session_sequence: code.slice(1),
    panda_code: code,
    member_id: memberId,
    display_name: input.name,
  } as SignIn);
  enqueue(a);
  res.json(a);
});
app.post("/api/admin/greet", (req, res) => {
  const { code } = z.object({ code: z.string().max(60) }).parse(req.body);
  const normalized = normalizePandaCode(code);
  const id = normalized && cache.membersByPandaCode.get(normalized);
  if (!id) return res.status(404).json({ error: "Unknown Panda code" });
  const m = cache.membersById.get(id)!;
  enqueue({
    eventId: randomUUID(),
    pandaCode: normalized!,
    displayCode: `Panda ${normalized!.slice(1)}`,
    displayName: m.display_name,
    firstName: m.first_name,
  });
  res.json({ ok: true });
});
app.post("/api/realtime/session", requireOwner, async (req, res) => {
  if (controls.mode !== "qa")
    return res.status(409).json({ error: "Switch to Q&A mode first" });
  const { sdp } = z
    .object({ sdp: z.string().min(20).max(24000) })
    .parse(req.body);
  res.json({ sdp: await realtime.connect(sdp, controls.responseVoice) });
});
app.post("/api/realtime/disconnect", requireOwner, async (_req, res) => {
  await realtime.disconnect();
  res.json({ ok: true });
});
app.use("/api", (_req, res) =>
  res.status(404).json({ error: "API route not found" }),
);
app.use(express.static(resolve("dist/client")));
app.get(["/", "/admin"], (_req, res) =>
  res.sendFile(resolve("dist/client/index.html")),
);
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const validation = err instanceof z.ZodError;
    log("REQUEST_ERROR", { type: validation ? "validation" : "service" });
    res.status(validation ? 400 : 502).json({
      error: validation
        ? "Invalid request"
        : err instanceof Error
          ? err.message
          : "Service unavailable",
    });
  },
);
async function start() {
  if (env.DEMO_MODE) {
    for (const [i, name] of [
      "Jordan Smith",
      "Alex Rivera",
      "Sam Chen",
    ].entries())
      cache.upsert({
        member_id: "demo-" + (i + 1),
        email_normalized: "",
        display_name: name,
        first_name: name.split(" ")[0],
        github_url: "",
        github_enrichment_consent: "false",
        major: "Computer Science",
        career_interest: i === 0 ? "AI / ML" : "Data engineering",
        current_goal: "Land a first technical internship",
        experience_level: "Intermediate",
      } as MemberProfile);
  } else if (poller) {
    await poller.refresh();
    await enrichment.hydrate();
    enrichmentReady = true;
    poller.start();
  }
  const server = app.listen(env.PORT, "127.0.0.1", () =>
    log("SERVER_READY", { port: env.PORT, demo: env.DEMO_MODE }),
  );
  process.on("SIGTERM", () => {
    poller?.stop();
    void realtime.disconnect();
    for (const client of clients) client.end();
    server.close();
  });
}
void start();
