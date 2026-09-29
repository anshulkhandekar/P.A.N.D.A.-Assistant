import { spokenQuestion } from "./services/DiscordCards.js";
import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolve, join } from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { WorkshopStore } from "./services/WorkshopStore.js";
import { DiscordWorkshop } from "./services/DiscordWorkshop.js";
import { openai } from "./services/OpenAIService.js";
import { env } from "./config/env.js";
import { personality } from "./config/personality.js";
export function workshopRouter(setPhase: (phase: string) => void) {
  const router = Router();
  const store = new WorkshopStore(
    resolve(process.env.PANDA_DATA_DIR || ".local-data", "workshop.sqlite"),
  );
  const config = {
    enabled: process.env.ENABLE_DISCORD_QA === "true",
    commandsOnly: process.env.DISCORD_COMMANDS_ONLY === "true",
    token: process.env.DISCORD_BOT_TOKEN || "",
    application: process.env.DISCORD_APPLICATION_ID || "",
    guild: process.env.DISCORD_GUILD_ID || "",
    channel: process.env.DISCORD_QUESTION_CHANNEL_ID || "",
    moderation: process.env.DISCORD_MODERATION_CHANNEL_ID || "",
    roles: (process.env.DISCORD_MODERATOR_ROLE_IDS || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  };
  const discord = new DiscordWorkshop(store, config);
  let lease: { id: string; until: number } | undefined;
  let playback: {
    id: string;
    text: string;
    nonce: string;
    provider: "native" | "openai";
  } | null = null;
  let audio: Promise<{ bytes: Buffer; type: string }> | undefined;
  const stop = () => {
    if (playback) store.finish(playback.id, false);
    playback = null;
    audio = undefined;
  };
  const check = () => {
    if (
      playback &&
      (store.phase !== "lecture" || !lease || lease.until < Date.now())
    )
      stop();
  };
  const status = () => {
    check();
    return {
      title: store.get("title", "New workshop"),
      session: store.session,
      phase: store.phase,
      acceptingQuestions: store.acceptingQuestions,
      questions: store.list(),
      playback,
      overlayConnected: !!lease && lease.until > Date.now(),
      discord: {
        status: discord.status,
        error: discord.error,
        configured: config.enabled && !!config.token,
        application: config.application,
        guild: config.guild,
        channel: config.channel,
        moderation: config.moderation,
        roles: config.roles,
      },
      speech: { native: process.platform === "darwin", openai: !!openai },
    };
  };
  router.get("/status", (_req, res) => res.json(status()));
  router.post("/session", (req, res) => {
    const b = z
      .object({
        action: z.enum(["start", "lecture", "arrivals", "end"]),
        title: z.string().trim().min(1).max(100).optional(),
      })
      .parse(req.body);
    stop();
    if (b.action === "start") store.start(b.title || "ADSC workshop");
    else if (b.action === "end") store.stop();
    else {
      if (!store.session) throw Error("Start a workshop first.");
      if (store.phase === "closed") throw Error("Start a workshop first.");
      store.set("phase", b.action);
    }
    setPhase(store.phase);
    res.json(status());
  });
  router.post("/discord/:action", async (req, res) => {
    if (req.params.action === "connect") await discord.connect();
    else if (req.params.action === "disconnect") await discord.disconnect();
    else if (req.params.action === "register") await discord.register();
    else throw Error("Unknown Discord action");
    res.json(status());
  });
  router.post("/intake", (req, res) => {
    const { locked } = z.object({ locked: z.boolean() }).parse(req.body);
    store.lockQuestions(locked);
    res.json(status());
  });
  router.post("/sample", (req, res) => {
    const b = z
      .object({
        name: z.string().trim().min(1).max(60),
        text: z.string().trim().min(3).max(600),
      })
      .parse(req.body);
    store.submit(randomUUID(), "local-" + randomUUID(), b.name, b.text);
    res.json(status());
  });
  router.post("/question/:id", (req, res) => {
    const { action } = z
      .object({
        action: z.enum(["approve", "deny", "answered", "retry", "first"]),
      })
      .parse(req.body);
    store.change(String(req.params.id), action, "local operator");
    res.json(status());
  });
  router.post("/overlay/claim", (req, res) => {
    check();
    const { id } = z.object({ id: z.string().uuid() }).parse(req.body);
    if (lease && lease.until > Date.now() && lease.id !== id)
      return res
        .status(409)
        .json({ error: "Another overlay owns question playback." });
    lease = { id, until: Date.now() + 8000 };
    res.json(status());
  });
  router.post("/read", (req, res) => {
    check();
    const { provider } = z
      .object({ provider: z.enum(["native", "openai"]) })
      .parse(req.body);
    if (!lease || lease.until < Date.now())
      throw Error("Open the workshop stage and enable playback first.");
    if (provider === "openai" && !openai)
      throw Error("Configure OPENAI_API_KEY or choose native speech.");
    if (provider === "native" && process.platform !== "darwin")
      throw Error("Native speech currently requires macOS.");
    const q = store.next();
    playback = {
      id: q.id,
      text: spokenQuestion(q),
      nonce: randomUUID(),
      provider,
    };
    audio = undefined;
    res.json(status());
  });
  router.post("/stop", (_req, res) => {
    stop();
    res.json(status());
  });
  router.post("/overlay/ack", (req, res) => {
    const b = z
      .object({
        id: z.string().uuid(),
        nonce: z.string().uuid(),
        ok: z.boolean(),
      })
      .parse(req.body);
    if (!lease || lease.id !== b.id || lease.until < Date.now())
      throw Error("Playback lease expired.");
    if (playback?.nonce === b.nonce) {
      store.finish(playback.id, b.ok);
      playback = null;
      audio = undefined;
    }
    res.json(status());
  });
  router.get("/audio/:nonce", async (req, res) => {
    check();
    const p = playback;
    if (
      !p ||
      p.nonce !== req.params.nonce ||
      req.headers["x-overlay-id"] !== lease?.id
    )
      return res
        .status(409)
        .json({ error: "This playback is no longer active." });
    audio ||= (async () => {
      if (p.provider === "openai") {
        const response = await openai!.audio.speech.create({
          model: env.TTS_MODEL,
          voice: env.TTS_VOICE as "coral",
          input: p.text,
          response_format: "mp3",
          instructions:
            "Read the supplied question exactly. Warm, curious university mascot; clear, natural pace. Do not answer it or add commentary.",
        });
        return {
          bytes: Buffer.from(await response.arrayBuffer()),
          type: "audio/mpeg",
        };
      }
      const dir = await mkdtemp(join(tmpdir(), "panda-speech-"));
      try {
        const file = join(dir, "question.wav");
        await new Promise<void>((resolve, reject) => {
          const child = spawn(
            "/usr/bin/say",
            [
              "-r",
              "165",
              "-o",
              file,
              "--file-format=WAVE",
              "--data-format=LEI16@22050",
              "-f",
              "-",
            ],
            { stdio: ["pipe", "ignore", "ignore"] },
          );
          const timer = setTimeout(() => {
            child.kill();
            reject(Error("Native speech timed out."));
          }, 30000);
          child.on("error", () => {
            clearTimeout(timer);
            reject(Error("Native speech unavailable."));
          });
          child.on("exit", (code) => {
            clearTimeout(timer);
            code === 0 ? resolve() : reject(Error("Native speech failed."));
          });
          child.stdin.on("error", () => {});
          child.stdin.end(p.text);
        });
        return { bytes: await readFile(file), type: "audio/wav" };
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    })();
    try {
      const result = await audio;
      if (playback?.nonce !== p.nonce) return res.status(409).end();
      res.type(result.type).send(result.bytes);
    } catch {
      if (playback?.nonce === p.nonce) stop();
      throw Error(
        "Question speech failed. Check voice settings, then retry the interrupted question.",
      );
    }
  });
  // Private, typed assistance never publishes or plays an answer automatically.
  router.post("/draft", async (req, res) => {
    const b = z
      .object({
        question: z.string().trim().min(3).max(2000),
        model: z.enum(["gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-luna"]),
        search: z.boolean().default(false),
      })
      .parse(req.body);
    if (!openai) throw Error("Set OPENAI_API_KEY for private AI drafts.");
    const response = await openai.responses.create({
      model: b.model,
      instructions:
        personality +
        "\nThis is a private typed question. Do not claim to know the asker. Answer the supplied question directly.",
      input: b.question,
      max_output_tokens: 600,
      ...(b.search ? { tools: [{ type: "web_search" as const }] } : {}),
    });
    res.json({
      text: response.output_text,
      usage: response.usage,
      model: b.model,
    });
  });
  process.once("SIGTERM", () => {
    stop();
    store.stop();
    void discord.disconnect();
  });
  return router;
}
