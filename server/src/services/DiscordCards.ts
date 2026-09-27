import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
  escapeMarkdown,
} from "discord.js";
import type { Question } from "./WorkshopStore.js";

export const ASK_DESCRIPTION = "Ask a workshop question";
export const REVIEW_DESCRIPTION = "Review workshop questions (officers only)";
export const LEGACY_ASK_DESCRIPTION =
  "Submit a question to the P.A.N.D.A. workshop queue";
export const LEGACY_REVIEW_DESCRIPTION =
  "Review pending P.A.N.D.A. questions (officers only)";
export function questionCommands() {
  return [
    new SlashCommandBuilder()
      .setName("ask")
      .setDescription(ASK_DESCRIPTION)
      .addStringOption((o) =>
        o
          .setName("question")
          .setDescription("What would you like to ask?")
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(600),
      )
      .addStringOption((o) =>
        o
          .setName("name")
          .setDescription("Your name for the presenter")
          .setRequired(true)
          .setMaxLength(60),
      )
      .addBooleanOption((o) =>
        o
          .setName("anonymous")
          .setDescription(
            "Don't read my name aloud (your Discord account stays visible)",
          ),
      ),
    new SlashCommandBuilder()
      .setName("review")
      .setDescription(REVIEW_DESCRIPTION)
      .addStringOption((o) =>
        o
          .setName("action")
          .setDescription("Pause or reopen question submissions")
          .addChoices(
            { name: "Lock questions", value: "lock" },
            { name: "Unlock questions", value: "unlock" },
          ),
      ),
  ];
}
export function submissionName(name: string | null) {
  if (!name?.trim()) throw Error("Please add your name.");
  return name.trim();
}
export function spokenQuestion(q: Question) {
  return `${q.anonymous ? "A member" : q.name} asks: ${q.text}`;
}
export function questionCard(q: Question, review = false) {
  const labels = {
    pending: "Pending approval",
    approved: "Approved",
    denied: "Not approved",
    playing: "Reading aloud",
    read: "Read aloud",
    answered: "Answered",
    interrupted: "Paused",
    ended: "Workshop ended",
  };
  const color =
    q.status === "pending"
      ? 0xc99b46
      : ["denied", "ended"].includes(q.status)
        ? 0x8c7772
        : 0x567c60;
  const card = new EmbedBuilder()
    .setTitle(
      q.anonymous ? "Anonymous asked" : `${escapeMarkdown(q.name)} asked`,
    )
    .setDescription(escapeMarkdown(q.text))
    .setColor(color)
    .addFields({ name: "Status", value: labels[q.status] })
    .setFooter({ text: "P.A.N.D.A. · Workshop questions" })
    .setTimestamp(q.created);
  if (/^\d{17,20}$/.test(q.author))
    card.addFields({ name: "Discord member", value: `<@${q.author}>` });
  if (review)
    card.addFields(
      { name: "Entered name", value: escapeMarkdown(q.name) },
      {
        name: "Read aloud as",
        value: q.anonymous
          ? "A member (name withheld)"
          : escapeMarkdown(q.name),
      },
    );
  return card;
}
export function reviewButtons(id: string, status = "pending") {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...(status === "pending"
      ? [
          new ButtonBuilder()
            .setCustomId("panda:approve:" + id)
            .setLabel("Approve")
            .setStyle(ButtonStyle.Success),
        ]
      : []),
    ...(["pending", "approved"].includes(status)
      ? [
          new ButtonBuilder()
            .setCustomId("panda:deny:" + id)
            .setLabel("Deny")
            .setStyle(ButtonStyle.Danger),
        ]
      : []),
    new ButtonBuilder()
      .setCustomId("panda:answer:" + id)
      .setLabel("Manual answer")
      .setStyle(ButtonStyle.Primary),
  );
}
