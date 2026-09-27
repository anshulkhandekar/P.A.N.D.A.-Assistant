import {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
  escapeMarkdown,
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  MessageType,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";
import { WorkshopStore } from "./WorkshopStore.js";
import {
  questionCommands,
  questionCard,
  reviewButtons,
  submissionName,
  ASK_DESCRIPTION,
  REVIEW_DESCRIPTION,
  LEGACY_ASK_DESCRIPTION,
  LEGACY_REVIEW_DESCRIPTION,
} from "./DiscordCards.js";
export interface DiscordConfig {
  enabled: boolean;
  token: string;
  application: string;
  guild: string;
  channel: string;
  moderation: string;
  roles: string[];
  commandsOnly?: boolean;
}
export class DiscordWorkshop {
  private client?: Client;
  private syncTimer?: ReturnType<typeof setInterval>;
  private syncing?: Promise<void>;
  // Persistent message IDs let edits recover after reconnects and local-console review.
  syncCards() {
    if (this.syncing) return this.syncing;
    this.syncing = (async () => {
      const client = this.client;
      if (!client?.isReady()) return;
      let failed = false;
      for (const answer of this.store.pendingAnswers()) {
        try {
          const channel = await client.channels.fetch(answer.channel);
          if (!channel?.isTextBased() || !("send" in channel))
            throw Error("Channel unavailable");
          const message = await channel.send({
            content: `<@${answer.author}> an officer answered your question.`,
            embeds: [
              new EmbedBuilder()
                .setTitle("Officer answer")
                .setDescription(escapeMarkdown(answer.text))
                .addFields({
                  name: "Question",
                  value: escapeMarkdown(answer.question_text).slice(0, 1024),
                })
                .setColor(0x567c60)
                .setFooter({
                  text: `Answered by ${answer.officer_name || "Officer"}`,
                }),
            ],
            allowedMentions: { parse: [], users: [answer.author] },
            nonce: answer.nonce,
            enforceNonce: true,
          });
          this.store.answerSent(answer.question, message.id);
        } catch {
          failed = true;
          this.error =
            "A question card or manual answer could not be delivered. The saved response will retry; check channel permissions.";
        }
      }
      for (const q of this.store.dirtyCards()) {
        try {
          const channel = await client.channels.fetch(q.channel);
          if (!channel?.isTextBased() || !("send" in channel))
            throw Error("Channel unavailable");
          const payload = {
            embeds: [questionCard(q)],
            allowedMentions: { parse: [] as never[] },
          };
          const message = q.message
            ? await channel.messages.edit(q.message, payload)
            : await channel.send({
                ...payload,
                nonce: q.id,
                enforceNonce: true,
              });
          this.store.cardSynced(q.id, message.id, q.status);
        } catch {
          failed = true;
          this.error =
            "A question card could not be published or updated. Check View Channel, Send Messages, Embed Links, and Read Message History. The queue is saved; updates will retry.";
        }
      }
      if (!failed && this.error.startsWith("A question card")) this.error = "";
    })().finally(() => {
      this.syncing = undefined;
    });
    return this.syncing;
  }
  status = "disconnected";
  error = "";
  constructor(
    private store: WorkshopStore,
    private config: DiscordConfig,
  ) {}
  async connect() {
    if (this.client) throw Error("Disconnect before connecting again.");
    const c = this.config;
    if (!c.enabled || !c.token || !c.application || !c.guild || !c.channel)
      throw Error(
        "Enable Discord and fill in token, application, server, and question-channel IDs in .env.",
      );
    this.status = "connecting";
    this.error = "";
    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        ...(c.commandsOnly ? [GatewayIntentBits.GuildMessages] : []),
      ],
    });
    this.client = client;
    client.on(Events.Error, () => {
      this.error = "Discord connection error. Disconnect and try again.";
    });
    client.on(Events.ShardDisconnect, () => {
      this.status = "reconnecting";
    });
    client.on(Events.ShardResume, () => {
      this.status = "connected";
    });
    if (c.commandsOnly)
      client.on(Events.MessageCreate, async (message) => {
        if (
          message.guildId !== c.guild ||
          message.channelId !== c.channel ||
          message.author.bot ||
          message.webhookId
        )
          return;
        if (![MessageType.Default, MessageType.Reply].includes(message.type))
          return;
        try {
          await message.delete();
        } catch {
          this.error =
            "Commands-only cleanup failed. Grant the bot Manage Messages in the question channel.";
        }
      });
    client.on(Events.InteractionCreate, async (i) => {
      if (i.guildId !== c.guild) return;
      const canReview = () => {
        const roles = i.member?.roles;
        const ids = Array.isArray(roles)
          ? roles
          : roles
            ? [...roles.cache.keys()]
            : [];
        if (!ids.some((id) => c.roles.includes(id)))
          throw Error("Only workshop officers can review questions.");
      };
      try {
        if (i.isChatInputCommand() && i.commandName === "review") {
          canReview();
          if (this.store.phase === "closed")
            throw Error("There is no active workshop right now.");
          const action = i.options.getString("action");
          if (action === "lock" || action === "unlock") {
            this.store.lockQuestions(action === "lock");
            await i.reply({
              content:
                action === "lock"
                  ? "Question submissions paused."
                  : "Question submissions open.",
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
          const pending = this.store
            .list()
            .filter((q) =>
              ["pending", "approved", "read", "interrupted"].includes(q.status),
            )
            .slice(0, 10);
          await i.deferReply({ flags: MessageFlags.Ephemeral });
          if (!pending.length) {
            await i.editReply("No questions available for review.");
            return;
          }
          // A separate private card puts simple Approve / Deny buttons beneath each question.
          for (const [index, q] of pending.entries()) {
            const payload = {
              embeds: [questionCard(q, true)],
              components: [reviewButtons(q.id, q.status)],
              allowedMentions: { parse: [] as never[] },
            };
            if (index === 0) await i.editReply(payload);
            else
              await i.followUp({ ...payload, flags: MessageFlags.Ephemeral });
          }
        } else if (i.isChatInputCommand() && i.commandName === "ask") {
          if (i.channelId !== c.channel)
            throw Error("Use /ask in the workshop question channel.");
          if (this.store.phase === "closed")
            throw Error("There is no active workshop right now.");
          const anonymous = i.options.getBoolean("anonymous") ?? false;
          const name = submissionName(i.options.getString("name"));
          const question = i.options.getString("question", true);
          // Public cards use the authenticated Discord account; speech uses the supplied name.
          await i.deferReply({ flags: MessageFlags.Ephemeral });
          const q = this.store.submit(
            i.id,
            i.user.id,
            name,
            question,
            anonymous,
            i.user.username,
          );
          this.store.trackCard(q.id, c.channel);
          await i.editReply("Question submitted.");
          await this.syncCards();
          if (c.moderation) {
            try {
              const channel = await client.channels.fetch(c.moderation);
              if (channel?.isTextBased() && "send" in channel)
                await channel.send({
                  embeds: [questionCard(q, true)],
                  components: [reviewButtons(q.id, q.status)],
                  allowedMentions: { parse: [] },
                });
            } catch {
              this.error =
                "Question saved, but the private review card could not be sent. Officers can use /review.";
            }
          }
        } else if (i.isButton() && i.customId.startsWith("panda:answer:")) {
          canReview();
          const id = i.customId.slice("panda:answer:".length);
          this.store.answerable(id);
          await i.showModal(
            new ModalBuilder()
              .setCustomId("panda:answer-submit:" + id)
              .setTitle("Answer this question")
              .addComponents(
                new ActionRowBuilder<TextInputBuilder>().addComponents(
                  new TextInputBuilder()
                    .setCustomId("answer")
                    .setLabel("Your response")
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMaxLength(1500),
                ),
              ),
          );
        } else if (
          i.isModalSubmit() &&
          i.customId.startsWith("panda:answer-submit:")
        ) {
          canReview();
          await i.deferReply({ flags: MessageFlags.Ephemeral });
          const id = i.customId.slice("panda:answer-submit:".length);
          this.store.manualAnswer(
            id,
            i.fields.getTextInputValue("answer"),
            i.user.id,
            i.id,
            (i.member && "displayName" in i.member
              ? i.member.displayName
              : i.member?.nick) ||
              i.user.globalName ||
              i.user.username,
          );
          await i.editReply(
            "Answer saved. It will be posted in the question channel and notify the asker.",
          );
          await this.syncCards();
        } else if (i.isButton() && /^panda:(approve|deny):/.test(i.customId)) {
          canReview();
          if (
            c.moderation &&
            i.channelId !== c.moderation &&
            !i.message.flags.has(MessageFlags.Ephemeral)
          )
            throw Error("Use /review or the officer review channel.");
          await i.deferUpdate();
          const [, action, id] = i.customId.split(":");
          this.store.change(id, action as "approve" | "deny", i.user.id);
          const q = this.store.list().find((q) => q.id === id)!;
          await i.editReply({
            content: "",
            embeds: [questionCard(q, true)],
            components: [],
            allowedMentions: { parse: [] },
          });
          await this.syncCards();
        }
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Could not process that question.";
        if (i.isRepliable()) {
          try {
            if (i.deferred || i.replied)
              await i.followUp({
                content: message,
                flags: MessageFlags.Ephemeral,
                allowedMentions: { parse: [] },
              });
            else
              await i.reply({
                content: message,
                flags: MessageFlags.Ephemeral,
                allowedMentions: { parse: [] },
              });
          } catch {}
        }
      }
    });
    try {
      await client.login(c.token);
      if (!client.isReady())
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(
            () => reject(Error("Discord connection timed out.")),
            15000,
          );
          client.once(Events.ClientReady, () => {
            clearTimeout(t);
            resolve();
          });
        });
      if (client.application?.id !== c.application)
        throw Error("Token belongs to a different Discord application.");
      const guild = await client.guilds.fetch(c.guild);
      const channel = await guild.channels.fetch(c.channel);
      const me = await guild.members.fetchMe();
      if (
        !channel ||
        !channel.isTextBased() ||
        !channel
          .permissionsFor(me)
          ?.has([
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.ReadMessageHistory,
            ...(c.commandsOnly ? [PermissionFlagsBits.ManageMessages] : []),
          ])
      )
        throw Error(
          "Bot needs View Channel and Send Messages in the question channel.",
        );
      if (c.moderation) {
        const mod = await guild.channels.fetch(c.moderation);
        if (
          !mod?.isTextBased() ||
          !mod
            .permissionsFor(me)
            ?.has([
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
            ])
        )
          throw Error("Bot cannot send to the moderation channel.");
        if (!c.roles.length)
          throw Error(
            "Configure DISCORD_MODERATOR_ROLE_IDS before enabling Discord moderation buttons.",
          );
      }
      this.status = "connected";
      this.syncTimer = setInterval(() => void this.syncCards(), 5000);
      this.syncTimer.unref();
      void this.syncCards();
    } catch {
      await this.disconnect();
      this.error =
        "Discord verification failed. Check the rotated token, IDs, bot installation, channel permissions (including Embed Links and Read Message History), and moderator role settings. Commands-only mode also needs Manage Messages.";
      throw Error(this.error);
    }
  }
  async register() {
    if (this.status !== "connected")
      throw Error("Connect and verify Discord first.");
    const c = this.config;
    const rest = new REST({ version: "10" }).setToken(c.token);
    const existing = (await rest.get(
      Routes.applicationGuildCommands(c.application, c.guild),
    )) as { id: string; name: string; description: string }[];
    const commands = questionCommands();
    const accepted = {
      ask: [ASK_DESCRIPTION, LEGACY_ASK_DESCRIPTION],
      review: [REVIEW_DESCRIPTION],
    };
    // Preflight every conflict before changing either command.
    for (const command of commands) {
      const body = command.toJSON();
      const old = existing.find((x) => x.name === body.name);
      if (
        old &&
        !accepted[body.name as keyof typeof accepted].includes(old.description)
      )
        throw Error(
          `This application already has a different /${body.name} command. No commands were changed.`,
        );
    }
    for (const command of commands) {
      const body = command.toJSON();
      const old = existing.find((x) => x.name === body.name);
      if (old)
        await rest.patch(
          Routes.applicationGuildCommand(c.application, c.guild, old.id),
          { body },
        );
      else
        await rest.post(
          Routes.applicationGuildCommands(c.application, c.guild),
          { body },
        );
    }
    const legacy = existing.find(
      (x) =>
        x.name === "panda-review" &&
        x.description === LEGACY_REVIEW_DESCRIPTION,
    );
    if (legacy)
      await rest.delete(
        Routes.applicationGuildCommand(c.application, c.guild, legacy.id),
      );
  }
  async disconnect() {
    clearInterval(this.syncTimer);
    await this.client?.destroy();
    this.client = undefined;
    this.status = "disconnected";
  }
}
