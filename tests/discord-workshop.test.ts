import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  handlers: new Map<string, Function>(),
  send: vi.fn(),
  edit: vi.fn(),
  restGet: vi.fn(),
  restPost: vi.fn(),
  restPatch: vi.fn(),
  restDelete: vi.fn(),
}));
vi.mock("discord.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("discord.js")>();
  return {
    ...actual,
    Client: class {
      application = { id: "app" };
      channels = {
        fetch: async () => ({
          isTextBased: () => true,
          send: mock.send,
          messages: { edit: mock.edit },
        }),
      };
      guilds = {
        fetch: async () => ({
          channels: {
            fetch: async () => ({
              isTextBased: () => true,
              permissionsFor: () => ({ has: () => true }),
            }),
          },
          members: { fetchMe: async () => ({}) },
        }),
      };
      on(event: string, fn: Function) {
        mock.handlers.set(event, fn);
      }
      isReady() {
        return true;
      }
      async login() {}
      async destroy() {}
    },
    REST: class {
      setToken() {
        return this;
      }
      get = mock.restGet;
      post = mock.restPost;
      patch = mock.restPatch;
      delete = mock.restDelete;
    },
  };
});
import { Events, MessageFlags } from "discord.js";
import { DiscordWorkshop } from "../server/src/services/DiscordWorkshop";
import { WorkshopStore } from "../server/src/services/WorkshopStore";
import {
  questionCommands,
  spokenQuestion,
  questionCard,
  LEGACY_ASK_DESCRIPTION,
  LEGACY_REVIEW_DESCRIPTION,
} from "../server/src/services/DiscordCards";
let store: WorkshopStore;
let bot: DiscordWorkshop;
beforeEach(async () => {
  vi.clearAllMocks();
  mock.handlers.clear();
  mock.send.mockResolvedValue({ id: "public-card" });
  mock.edit.mockResolvedValue({ id: "public-card" });
  mock.restGet.mockResolvedValue([]);
  store = new WorkshopStore(":memory:");
  store.start("Test");
  bot = new DiscordWorkshop(store, {
    enabled: true,
    token: "fake",
    application: "app",
    guild: "guild",
    channel: "questions",
    moderation: "",
    roles: ["officer"],
    commandsOnly: true,
  });
  await bot.connect();
});
afterEach(async () => {
  await bot.disconnect();
  store.db.close();
});
function command(
  name: string,
  options: Record<string, unknown> = {},
  roles: string[] = [],
) {
  return {
    id: "submission",
    guildId: "guild",
    channelId: "questions",
    user: {
      id: "123456789012345678",
      username: "actual.discord.user",
      globalName: "Unchill1",
    },
    member: { roles },
    commandName: name,
    options: {
      getString: (key: string) => options[key] ?? null,
      getBoolean: (key: string) => options[key] ?? null,
    },
    isChatInputCommand: () => true,
    isButton: () => false,
    isModalSubmit: () => false,
    isRepliable: () => true,
    deferReply: vi.fn(),
    editReply: vi.fn(),
    followUp: vi.fn(),
    reply: vi.fn(),
  };
}
const dispatch = (i: unknown) =>
  mock.handlers.get(Events.InteractionCreate)!(i);
it("registers inline question, anonymous and name options", () => {
  const [ask, review] = questionCommands().map((c) => c.toJSON());
  expect(ask.options?.map((o) => o.name)).toEqual([
    "question",
    "name",
    "anonymous",
  ]);
  expect(ask.options?.[0].required).toBe(true);
  expect(review.name).toBe("review");
});
it("keeps Discord identity visible but omits the spoken name when requested", async () => {
  const i = command("ask", {
    question: "Why use a baseline?",
    anonymous: true,
    name: "Private name",
  });
  await dispatch(i);
  expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
  expect(store.list()[0]).toMatchObject({
    name: "Private name",
    anonymous: 1,
    author: "123456789012345678",
    status: "pending",
  });
  const payload = JSON.stringify(mock.send.mock.calls[0][0]);
  expect(payload).toContain("Anonymous asked");
  expect(payload).toContain("Pending approval");
  expect(payload).toContain("123456789012345678");
  expect(spokenQuestion(store.list()[0])).toBe(
    "A member asks: Why use a baseline?",
  );
  expect(JSON.stringify(questionCard(store.list()[0], true))).toContain(
    "Private name",
  );
  expect(payload).not.toContain("Private name");
  store.change("submission", "approve", "local operator");
  await bot.syncCards();
  expect(mock.edit.mock.calls[0][0]).toBe("public-card");
  expect(JSON.stringify(mock.edit.mock.calls[0][1])).toContain("Approved");
  expect(mock.send).toHaveBeenCalledTimes(1);
});
it("requires a name for non-anonymous questions and rejects the wrong channel", async () => {
  const i = command("ask", { question: "Why?" });
  await dispatch(i);
  expect(i.reply.mock.calls[0][0].content).toContain("add your name");
  const wrong = {
    ...command("ask", { question: "Why?", name: "A" }),
    channelId: "elsewhere",
  };
  await dispatch(wrong);
  expect(wrong.reply.mock.calls[0][0].content).toContain(
    "workshop question channel",
  );
  expect(store.list()).toHaveLength(0);
  expect(mock.send).not.toHaveBeenCalled();
});
it("gives officers individual review cards and enforces officer roles on buttons", async () => {
  store.submit("a", "one", "Anshul", "First question");
  store.submit("b", "two", "Bob", "Second question");
  const member = command("review");
  await dispatch(member);
  expect(member.reply.mock.calls[0][0].content).toContain(
    "Only workshop officers",
  );
  const review = command("review", {}, ["officer"]);
  await dispatch(review);
  expect(review.editReply).toHaveBeenCalledTimes(1);
  expect(review.followUp).toHaveBeenCalledTimes(1);
  expect(
    review.editReply.mock.calls[0][0].components[0]
      .toJSON()
      .components.map((b: any) => b.label),
  ).toEqual(["Approve", "Deny", "Manual answer"]);
  const button = {
    ...command(""),
    isChatInputCommand: () => false,
    isButton: () => true,
    customId: "panda:approve:a",
    message: { flags: { has: () => true } },
    deferUpdate: vi.fn(),
  };
  await dispatch(button);
  expect(store.list()[0].status).toBe("pending");
  await dispatch({ ...button, member: { roles: ["officer"] } });
  expect(store.list()[0].status).toBe("approved");
  expect(store.list()[1].status).toBe("pending");
});
it("retries failed card edits without creating another public post", async () => {
  await dispatch(command("ask", { question: "Why?", name: "Anshul" }));
  store.change("submission", "deny", "officer");
  mock.edit.mockRejectedValueOnce(Error("offline"));
  await bot.syncCards();
  expect(store.dirtyCards()).toHaveLength(1);
  await bot.syncCards();
  expect(store.dirtyCards()).toHaveLength(0);
  expect(mock.send).toHaveBeenCalledTimes(1);
});
it("migrates only its own legacy commands and preflights conflicting review commands", async () => {
  mock.restGet.mockResolvedValue([
    { id: "ask-id", name: "ask", description: LEGACY_ASK_DESCRIPTION },
    {
      id: "old-review",
      name: "panda-review",
      description: LEGACY_REVIEW_DESCRIPTION,
    },
    { id: "unrelated", name: "help", description: "Help" },
  ]);
  await bot.register();
  expect(mock.restPatch).toHaveBeenCalledTimes(1);
  expect(mock.restPost).toHaveBeenCalledTimes(1);
  expect(mock.restDelete.mock.calls[0][0]).toContain("old-review");
  vi.clearAllMocks();
  mock.restGet.mockResolvedValue([
    { id: "other", name: "review", description: "Another bot feature" },
  ]);
  await expect(bot.register()).rejects.toThrow("No commands were changed");
  expect(mock.restPost).not.toHaveBeenCalled();
  expect(mock.restPatch).not.toHaveBeenCalled();
  expect(mock.restDelete).not.toHaveBeenCalled();
});
it("commands-only cleanup touches ordinary messages only in the configured channel", async () => {
  const message = {
    guildId: "guild",
    channelId: "questions",
    author: { bot: false },
    type: 0,
    delete: vi.fn(),
  };
  await mock.handlers.get(Events.MessageCreate)!(message);
  expect(message.delete).toHaveBeenCalledTimes(1);
  message.delete.mockClear();
  await mock.handlers.get(Events.MessageCreate)!({
    ...message,
    channelId: "other",
  });
  await mock.handlers.get(Events.MessageCreate)!({
    ...message,
    author: { bot: true },
  });
  expect(message.delete).not.toHaveBeenCalled();
});
it("officers can pause intake without stopping review, while members cannot unlock it", async () => {
  await dispatch(command("review", { action: "lock" }, ["officer"]));
  expect(store.acceptingQuestions).toBe(false);
  await dispatch(command("ask", { question: "Why?", name: "Anshul" }));
  expect(store.list()).toHaveLength(0);
  await dispatch(command("review", { action: "unlock" }));
  expect(store.acceptingQuestions).toBe(false);
  await dispatch(command("review", { action: "unlock" }, ["officer"]));
  expect(store.acceptingQuestions).toBe(true);
  store.stop();
  await dispatch(command("review", { action: "unlock" }, ["officer"]));
  expect(store.acceptingQuestions).toBe(false);
  store.start("Next workshop");
  expect(store.acceptingQuestions).toBe(true);
});
it("reads the entered name rather than the Discord username for normal questions", async () => {
  await dispatch(command("ask", { question: "Why?", name: "Anshul" }));
  expect(spokenQuestion(store.list()[0])).toBe("Anshul asks: Why?");
  expect(JSON.stringify(mock.send.mock.calls[0][0])).toContain("Anshul asked");
});
it("opens an officer answer form and posts one targeted reply without playing the question", async () => {
  await dispatch(command("ask", { question: "Why?", name: "Anshul" }));
  const button = {
    ...command("", {}, ["officer"]),
    isChatInputCommand: () => false,
    isButton: () => true,
    customId: "panda:answer:submission",
    showModal: vi.fn(),
  };
  await dispatch(button);
  expect(button.showModal).toHaveBeenCalledTimes(1);
  const modal = {
    ...command("", {}, ["officer"]),
    id: "answer-interaction",
    isChatInputCommand: () => false,
    isModalSubmit: () => true,
    customId: "panda:answer-submit:submission",
    fields: { getTextInputValue: () => "Try a baseline. @everyone" },
  };
  await dispatch(modal);
  expect(store.list()[0].status).toBe("answered");
  const posted = mock.send.mock.calls[1][0];
  expect(posted.content).toContain("<@123456789012345678>");
  expect(posted.allowedMentions).toEqual({
    parse: [],
    users: ["123456789012345678"],
  });
  expect(JSON.stringify(posted.embeds)).toContain("Try a baseline.");
  expect(JSON.stringify(posted.embeds)).toContain("Answered by Unchill1");
  expect(JSON.stringify(posted.embeds)).not.toContain("Workshop team");
  expect(store.pendingAnswers()).toHaveLength(0);
  await dispatch(modal);
  expect(mock.send).toHaveBeenCalledTimes(2);
});
it("rechecks officer authorization on answer submission and retries failed delivery", async () => {
  await dispatch(command("ask", { question: "Why?", name: "Anshul" }));
  const modal = {
    ...command(""),
    id: "answer-interaction",
    isChatInputCommand: () => false,
    isModalSubmit: () => true,
    customId: "panda:answer-submit:submission",
    fields: { getTextInputValue: () => "A helpful answer." },
  };
  await dispatch(modal);
  expect(store.list()[0].status).toBe("pending");
  mock.send.mockRejectedValueOnce(Error("network"));
  await dispatch({ ...modal, member: { roles: ["officer"] } });
  expect(store.pendingAnswers()).toHaveLength(1);
  await bot.syncCards();
  expect(store.pendingAnswers()).toHaveLength(0);
});
it("updates the existing public card to Workshop ended after a new session starts", async () => {
  await dispatch(command("ask", { question: "Why?", name: "Anshul" }));
  store.start("Next workshop");
  await bot.syncCards();
  expect(mock.edit.mock.calls[0][0]).toBe("public-card");
  expect(JSON.stringify(mock.edit.mock.calls[0][1])).toContain(
    "Workshop ended",
  );
  expect(mock.send).toHaveBeenCalledTimes(1);
});
