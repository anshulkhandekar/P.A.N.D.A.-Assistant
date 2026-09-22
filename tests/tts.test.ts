import { expect, it, vi } from "vitest";
import type { Arrival } from "../shared/domain";
const { synthesize } = vi.hoisted(() => ({
  synthesize: vi.fn(async ({ voice }: { voice: string }) => ({
    arrayBuffer: async () => Buffer.from(voice),
  })),
}));
vi.mock("../server/src/config/env.js", () => ({
  env: {
    OPENAI_API_KEY: "test",
    TTS_MODEL: "gpt-4o-mini-tts",
    TTS_VOICE: "coral",
  },
  log: vi.fn(),
}));
vi.mock("openai", () => ({
  default: class {
    audio = { speech: { create: synthesize } };
  },
}));
import { TTSService } from "../server/src/services/OpenAIService";

it("separates greeting audio caches by selected voice and deduplicates same-voice requests", async () => {
  const service = new TTSService();
  const arrival = {
    eventId: "one",
    firstName: "Jordan",
    pandaCode: "P1",
    displayCode: "Panda 1",
    displayName: "Jordan",
  } as Arrival;
  const [first, duplicate] = await Promise.all([
    service.greeting(arrival, "marin"),
    service.greeting(arrival, "marin"),
  ]);
  expect(first.toString()).toBe("marin");
  expect(duplicate).toEqual(first);
  expect((await service.greeting(arrival, "cedar")).toString()).toBe("cedar");
  expect((await service.greeting(arrival, "marin")).toString()).toBe("marin");
  expect(synthesize).toHaveBeenCalledTimes(2);
});
