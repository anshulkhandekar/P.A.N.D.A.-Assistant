import { it, expect, vi } from "vitest";
import { SheetPoller } from "../server/src/services/SheetPoller.js";
import { parseSignIns } from "../server/src/services/GoogleSheetsService.js";
const row = (n: number) => ({
  eventId: `e${n}`,
  displayName: "Jordan",
  firstName: "Jordan",
});
it("baselines existing responses, emits new sign-ins once, and recovers from errors", async () => {
  let events = [row(1)],
    fail = false;
  const snapshot = vi.fn(async () => {
    if (fail) throw Error("offline");
    return events;
  });
  const emit = vi.fn();
  const poller = new SheetPoller({ snapshot }, emit);
  await poller.refresh();
  expect(emit).not.toHaveBeenCalled();
  events = [row(1), row(2), row(3)];
  await poller.refresh();
  expect(emit.mock.calls.map((c) => c[0].eventId)).toEqual(["e2", "e3"]);
  events.reverse();
  await poller.refresh();
  expect(emit).toHaveBeenCalledTimes(2);
  fail = true;
  await poller.refresh();
  expect(poller.lastError).toBe("offline");
  fail = false;
  events.push(row(4));
  await poller.refresh();
  expect(emit).toHaveBeenCalledTimes(3);
  expect(poller.lastError).toBeNull();
  expect(poller.rowCount).toBe(4);
});
it("does not baseline a failed read or overlap concurrent refreshes", async () => {
  let release!: (value: any) => void;
  const snapshot = vi.fn(
    () =>
      new Promise<any>((resolve) => {
        release = resolve;
      }),
  );
  const emit = vi.fn();
  const poller = new SheetPoller({ snapshot }, emit);
  const first = poller.refresh(),
    second = poller.refresh();
  expect(snapshot).toHaveBeenCalledTimes(1);
  release([row(1)]);
  await Promise.all([first, second]);
  expect(emit).not.toHaveBeenCalled();
});
it("maps reordered multiline headers and excludes every unrelated answer", () => {
  const parsed = parseSignIns(
    [
      ["Prize choice", "What's your\n name?", "Timestamp", "Email Address"],
      ["secret", "Anshul K", "time", "private@example.com"],
    ],
    "What's your name?",
    "Timestamp",
  );
  expect(parsed[0]).toMatchObject({
    displayName: "Anshul K",
    firstName: "Anshul",
  });
  expect(JSON.stringify(parsed)).not.toMatch(/secret|private@example/);
  const edited = parseSignIns(
    [
      ["Timestamp", "What's your name?"],
      ["time", "Anshul K"],
    ],
    "What's your name?",
    "Timestamp",
  );
  expect(edited).toEqual(parsed);
});
it("requires unambiguous configured headers, skips incomplete rows, and preserves identical submissions", () => {
  expect(() =>
    parseSignIns([["Timestamp", "Full name"]], "Name", "Timestamp"),
  ).toThrow("Missing response header: Name");
  expect(() =>
    parseSignIns([["Timestamp", "Name", "Name"]], "Name", "Timestamp"),
  ).toThrow("Duplicate");
  expect(() => parseSignIns([["Name"]], "Name", "Name")).toThrow(
    "different columns",
  );
  const parsed = parseSignIns(
    [
      ["Name", "Timestamp"],
      ["", "time"],
      ["Jordan", ""],
      ["Jordan", "same"],
      ["Jordan", "same"],
    ],
    "Name",
    "Timestamp",
  );
  expect(parsed).toHaveLength(2);
  expect(parsed[0].eventId).not.toBe(parsed[1].eventId);
});
