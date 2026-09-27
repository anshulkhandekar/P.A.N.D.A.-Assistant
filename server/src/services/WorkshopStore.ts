import { cleanQuestionInput } from "./QuestionInput.js";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
export type QuestionStatus =
  | "pending"
  | "approved"
  | "playing"
  | "read"
  | "answered"
  | "denied"
  | "interrupted"
  | "ended";
export interface Question {
  id: string;
  session: string;
  name: string;
  text: string;
  author: string;
  status: QuestionStatus;
  position: number;
  created: number;
  reviewer: string | null;
  anonymous: number;
  discord_username: string;
}
export class WorkshopStore {
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS questions (id TEXT PRIMARY KEY, session TEXT NOT NULL, name TEXT NOT NULL, text TEXT NOT NULL, author TEXT NOT NULL, status TEXT NOT NULL, position INTEGER NOT NULL, created INTEGER NOT NULL, reviewer TEXT);`);
    const columns = this.db.prepare("PRAGMA table_info(questions)").all() as {
      name: string;
    }[];
    if (!columns.some((c) => c.name === "anonymous"))
      this.db.exec(
        "ALTER TABLE questions ADD COLUMN anonymous INTEGER NOT NULL DEFAULT 0",
      );
    if (!columns.some((c) => c.name === "discord_username"))
      this.db.exec(
        "ALTER TABLE questions ADD COLUMN discord_username TEXT NOT NULL DEFAULT ''",
      );
    this.db.exec(`CREATE TABLE IF NOT EXISTS question_cards (
      question TEXT PRIMARY KEY, channel TEXT NOT NULL, message TEXT,
      synced_status TEXT NOT NULL DEFAULT ''
    )`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS manual_answers (
      question TEXT PRIMARY KEY, text TEXT NOT NULL, officer TEXT NOT NULL,
      nonce TEXT NOT NULL, message TEXT
    )`);
    const answerColumns = this.db
      .prepare("PRAGMA table_info(manual_answers)")
      .all() as { name: string }[];
    if (!answerColumns.some((c) => c.name === "officer_name"))
      this.db.exec(
        "ALTER TABLE manual_answers ADD COLUMN officer_name TEXT NOT NULL DEFAULT ''",
      );
    // Refresh existing card headings once when upgrading.
    if (this.get("card_format") !== "anonymous-heading-v2") {
      this.db.exec("UPDATE question_cards SET synced_status=''");
      this.set("card_format", "anonymous-heading-v2");
    }
    // Recover all unfinished questions, including older abandoned sessions.
    this.stop();
  }
  get(key: string, fallback = "") {
    return (
      (
        this.db.prepare("SELECT value FROM settings WHERE key=?").get(key) as
          { value: string } | undefined
      )?.value ?? fallback
    );
  }
  set(key: string, value: string) {
    this.db
      .prepare(
        "INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, value);
  }
  get session() {
    return this.get("session");
  }
  get phase() {
    if (
      this.get("phase", "closed") !== "closed" &&
      Date.now() > Number(this.get("expires", "0"))
    )
      this.stop();
    return this.get("phase", "closed");
  }
  get acceptingQuestions() {
    return this.phase !== "closed" && this.get("intake_locked") !== "true";
  }
  lockQuestions(locked: boolean) {
    if (!locked && this.phase === "closed")
      throw Error("Start a workshop before opening questions.");
    this.set("intake_locked", String(locked));
  }
  start(title: string) {
    this.stop();
    this.set("session", randomUUID());
    this.set("title", title);
    this.set("expires", String(Date.now() + 6 * 60 * 60 * 1000));
    this.set("phase", "arrivals");
    this.lockQuestions(false);
  }
  stop() {
    this.set("phase", "closed");
    this.db
      .prepare(
        "UPDATE questions SET status='ended' WHERE status IN ('pending','approved','playing','interrupted')",
      )
      .run();
  }
  list() {
    return this.db
      .prepare(
        "SELECT * FROM questions WHERE session=? ORDER BY position,created",
      )
      .all(this.session) as unknown as Question[];
  }
  submit(
    id: string,
    author: string,
    name: string,
    text: string,
    anonymous = false,
    discordUsername = "",
  ) {
    if (this.phase === "closed") throw Error("No workshop is open.");
    if (!this.acceptingQuestions)
      throw Error(
        "Questions are paused by an officer. Please try again later.",
      );
    ({ name, text } = cleanQuestionInput(name, text));
    const existing = this.db
      .prepare("SELECT * FROM questions WHERE id=?")
      .get(id);
    if (existing) return existing as unknown as Question;
    const previous = this.list().filter((q) => q.author === author);
    if (previous.some((q) => Date.now() - q.created < 15000))
      throw Error("Please wait 15 seconds before another question.");
    if (
      previous.filter((q) => ["pending", "approved"].includes(q.status))
        .length >= 3
    )
      throw Error("You already have three questions waiting.");
    this.db
      .prepare(
        "INSERT INTO questions (id,session,name,text,author,status,position,created,reviewer,anonymous,discord_username) VALUES (?,?,?,?,?,?,?,?,NULL,?,?)",
      )
      .run(
        id,
        this.session,
        name,
        text,
        author,
        "pending",
        Date.now(),
        Date.now(),
        anonymous ? 1 : 0,
        discordUsername,
      );
    return this.list().find((q) => q.id === id)!;
  }
  trackCard(id: string, channel: string) {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO question_cards(question,channel) VALUES (?,?)",
      )
      .run(id, channel);
  }
  dirtyCards() {
    // Expiry must also close cards when no operator window is polling.
    void this.phase;
    return this.db
      .prepare(
        `SELECT q.*, c.channel, c.message FROM questions q
      JOIN question_cards c ON c.question=q.id WHERE c.synced_status != q.status`,
      )
      .all() as unknown as (Question & {
      channel: string;
      message: string | null;
    })[];
  }
  cardSynced(id: string, message: string, status: string) {
    this.db
      .prepare(
        "UPDATE question_cards SET message=?,synced_status=? WHERE question=?",
      )
      .run(message, status, id);
  }
  answerable(id: string) {
    if (this.phase === "closed")
      throw Error("Start or resume a workshop first.");
    const q = this.list().find((q) => q.id === id);
    if (
      !q ||
      !["pending", "approved", "read", "interrupted"].includes(q.status)
    )
      throw Error("This question is no longer available for a manual answer.");
    if (
      this.db
        .prepare("SELECT question FROM manual_answers WHERE question=?")
        .get(id)
    )
      throw Error("An officer has already answered this question.");
    return q;
  }
  manualAnswer(
    id: string,
    text: string,
    officer: string,
    nonce: string,
    officerName = "Officer",
  ) {
    const q = this.answerable(id);
    text = text.trim();
    if (!text || text.length > 1500)
      throw Error("Enter an answer between 1 and 1500 characters.");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          "INSERT INTO manual_answers(question,text,officer,nonce,officer_name) VALUES (?,?,?,?,?)",
        )
        .run(id, text, officer, nonce, officerName);
      this.db
        .prepare("UPDATE questions SET status='answered',reviewer=? WHERE id=?")
        .run(officer, id);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return q;
  }
  pendingAnswers() {
    return this.db
      .prepare(
        `SELECT a.*, q.author, q.text AS question_text, c.channel
      FROM manual_answers a JOIN questions q ON q.id=a.question
      JOIN question_cards c ON c.question=q.id WHERE a.message IS NULL`,
      )
      .all() as unknown as {
      question: string;
      text: string;
      officer: string;
      officer_name: string;
      nonce: string;
      author: string;
      question_text: string;
      channel: string;
    }[];
  }
  answerSent(id: string, message: string) {
    this.db
      .prepare("UPDATE manual_answers SET message=? WHERE question=?")
      .run(message, id);
  }
  change(
    id: string,
    action: "approve" | "deny" | "answered" | "retry" | "first",
    reviewer: string,
  ) {
    if (this.phase === "closed")
      throw Error("Start or resume a workshop first.");
    const q = this.list().find((q) => q.id === id);
    if (!q) throw Error("Question not found in this workshop.");
    const allowed = {
      approve: ["pending"],
      deny: ["pending", "approved"],
      answered: ["read"],
      retry: ["interrupted", "read"],
      first: ["approved"],
    } as const;
    if (!(allowed[action] as readonly string[]).includes(q.status))
      throw Error("This question has already changed. Refresh the queue.");
    if (action === "first")
      this.db
        .prepare("UPDATE questions SET position=? WHERE id=?")
        .run(Math.min(...this.list().map((q) => q.position)) - 1, id);
    else
      this.db
        .prepare("UPDATE questions SET status=?,reviewer=? WHERE id=?")
        .run(
          (
            {
              approve: "approved",
              deny: "denied",
              answered: "answered",
              retry: "approved",
            } as const
          )[action],
          reviewer,
          id,
        );
  }
  next() {
    if (this.phase !== "lecture")
      throw Error("Switch to lecture mode before reading questions.");
    if (this.list().some((q) => q.status === "playing"))
      throw Error("A question is already playing.");
    const q = this.list().find((q) => q.status === "approved");
    if (!q) throw Error("No approved questions are ready.");
    this.db
      .prepare(
        "UPDATE questions SET status='playing' WHERE id=? AND status='approved'",
      )
      .run(q.id);
    return { ...q, status: "playing" as const };
  }
  finish(id: string, ok: boolean) {
    this.db
      .prepare(
        "UPDATE questions SET status=? WHERE id=? AND session=? AND status='playing'",
      )
      .run(ok ? "read" : "interrupted", id, this.session);
  }
}
