import { expect, it } from "vitest";
import { WorkshopStore } from "../server/src/services/WorkshopStore";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
it("requires an active session, approval, and an explicit lecture release", () => {
  const s = new WorkshopStore(":memory:");
  expect(() => s.submit("a", "u", "Jordan", "Why?")).toThrow("No workshop");
  s.start("Workshop");
  s.submit("a", "u", "Jordan", "Why?");
  expect(s.submit("a", "u", "Jordan", "Why?").id).toBe("a");
  expect(() => s.next()).toThrow("lecture");
  s.set("phase", "lecture");
  expect(() => s.next()).toThrow("No approved");
  s.change("a", "approve", "officer");
  expect(s.next().id).toBe("a");
  expect(() => s.next()).toThrow("already playing");
  expect(() => s.change("a", "approve", "officer")).toThrow("already changed");
  s.finish("a", true);
  expect(s.list()[0].status).toBe("read");
  s.change("a", "answered", "officer");
  expect(s.list()[0].status).toBe("answered");
  s.db.close();
});
it("closes unfinished questions after a crash without resuming playback", () => {
  const dir = mkdtempSync(join(tmpdir(), "panda-test-"));
  const file = join(dir, "queue.sqlite");
  try {
    const s = new WorkshopStore(file);
    s.start("Workshop");
    s.submit("a", "u", "Jordan", "Why?");
    s.change("a", "approve", "officer");
    s.set("phase", "lecture");
    s.next();
    s.db.close();
    const restored = new WorkshopStore(file);
    expect(restored.phase).toBe("closed");
    expect(restored.list()[0].status).toBe("ended");
    expect(() => restored.next()).toThrow();
    restored.set("phase", "lecture");
    expect(() => restored.change("a", "retry", "officer")).toThrow();
    expect(() => restored.next()).toThrow("No approved");
    restored.stop();
    expect(restored.list()[0].status).toBe("ended");
    restored.db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
it("rejects duplicate review, stale-session actions, and expired intake", () => {
  const s = new WorkshopStore(":memory:");
  s.start("One");
  s.submit("a", "u", "A", "Q");
  s.change("a", "deny", "mod");
  expect(() => s.change("a", "approve", "mod")).toThrow();
  s.start("Two");
  expect(() => s.change("a", "approve", "mod")).toThrow("not found");
  s.set("expires", "1");
  expect(() => s.submit("b", "u", "A", "Q")).toThrow("No workshop");
  s.db.close();
});
it("rate limits an attendee without losing the accepted question", () => {
  const s = new WorkshopStore(":memory:");
  s.start("One");
  s.submit("a", "u", "A", "Q");
  expect(() => s.submit("b", "u", "A", "Q2")).toThrow("15 seconds");
  expect(s.list()).toHaveLength(1);
  s.db.close();
});
it("rejects blank or oversized submissions before adding them to the queue", () => {
  const s = new WorkshopStore(":memory:");
  s.start("One");
  expect(() => s.submit("a", "u", "  ", "Q")).toThrow("Enter a name");
  expect(() => s.submit("a", "u", "A", " ")).toThrow("Enter a name");
  expect(() => s.submit("a", "u", "A", "Q".repeat(601))).toThrow();
  expect(s.list()).toHaveLength(0);
  expect(s.submit("a", "u", " A ", " Q ").name).toBe("A");
  s.db.close();
});
it("migrates the old queue without losing questions and persists public card references", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const dir = mkdtempSync(join(tmpdir(), "panda-migration-"));
  const file = join(dir, "queue.sqlite");
  try {
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
      INSERT INTO settings VALUES ('session','old-session');
      CREATE TABLE questions (id TEXT PRIMARY KEY, session TEXT NOT NULL, name TEXT NOT NULL, text TEXT NOT NULL, author TEXT NOT NULL, status TEXT NOT NULL, position INTEGER NOT NULL, created INTEGER NOT NULL, reviewer TEXT);
      INSERT INTO questions VALUES ('old','old-session','Jordan','Why?','user','pending',1,1,NULL);`);
    old.close();
    const migrated = new WorkshopStore(file);
    expect(migrated.list()[0]).toMatchObject({
      id: "old",
      name: "Jordan",
      anonymous: 0,
      status: "ended",
    });
    migrated.trackCard("old", "channel");
    migrated.cardSynced("old", "message", "pending");
    migrated.db.close();
    const restarted = new WorkshopStore(file);
    expect(restarted.dirtyCards()).toHaveLength(1);
    restarted.set("expires", String(Date.now() + 60000));
    restarted.set("phase", "lecture");
    expect(() => restarted.change("old", "approve", "officer")).toThrow();
    expect(restarted.dirtyCards()[0]).toMatchObject({
      message: "message",
      channel: "channel",
      status: "ended",
    });
    restarted.db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
it("retains an undelivered manual answer across restart and prevents a second answer", () => {
  const dir = mkdtempSync(join(tmpdir(), "panda-answer-"));
  const file = join(dir, "queue.sqlite");
  try {
    const s = new WorkshopStore(file);
    s.start("Workshop");
    s.submit("q", "123456789012345678", "Jordan", "Why?");
    s.trackCard("q", "channel");
    s.manualAnswer("q", "A saved answer.", "officer", "nonce");
    expect(() =>
      s.manualAnswer("q", "A second answer.", "other", "other-nonce"),
    ).toThrow();
    s.db.close();
    const r = new WorkshopStore(file);
    expect(r.pendingAnswers()[0]).toMatchObject({
      text: "A saved answer.",
      author: "123456789012345678",
      channel: "channel",
    });
    expect(r.list()[0].status).toBe("answered");
    r.answerSent("q", "posted-message");
    expect(r.pendingAnswers()).toHaveLength(0);
    r.db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
it("ends old queued questions on stop or replacement and leaves completed history intact", () => {
  const s = new WorkshopStore(":memory:");
  s.start("One");
  for (const id of ["pending", "approved", "denied", "answered"]) {
    s.submit(id, id, "Jordan", "Why?");
    s.trackCard(id, "channel");
    s.cardSynced(id, id, "pending");
  }
  s.change("approved", "approve", "officer");
  s.change("denied", "deny", "officer");
  s.manualAnswer("answered", "Done", "officer", "nonce");
  s.start("Two");
  expect(s.list()).toHaveLength(0);
  expect(s.dirtyCards().map((q) => [q.id, q.status])).toEqual([
    ["pending", "ended"],
    ["approved", "ended"],
    ["denied", "denied"],
    ["answered", "answered"],
  ]);
  s.submit("new", "new", "Jordan", "Why?");
  s.stop();
  expect(s.list()[0].status).toBe("ended");
  s.db.close();
});
it("expires pending cards even without an operator status request", () => {
  const s = new WorkshopStore(":memory:");
  s.start("One");
  s.submit("q", "user", "Jordan", "Why?");
  s.trackCard("q", "channel");
  s.cardSynced("q", "card", "pending");
  s.set("expires", "1");
  expect(s.dirtyCards()[0]).toMatchObject({ status: "ended", message: "card" });
  expect(s.phase).toBe("closed");
  s.db.close();
});
