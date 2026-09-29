import { it, expect } from "vitest";
import { GreetingQueue, greetingFor, type Arrival } from "../shared/domain.js";
it("keeps greetings FIFO and deduplicates SSE reconnects", () => {
  const q = new GreetingQueue();
  const a = { eventId: "a", displayName: "Jordan Smith", firstName: "Jordan" };
  q.enqueue(a);
  expect(q.enqueue(a)).toBe(false);
  q.enqueue({ ...a, eventId: "b" });
  expect(q.shift()).toEqual(a);
  expect(q.shift()?.eventId).toBe("b");
  q.enqueue({ ...a, eventId: "c" });
  q.clear();
  expect(q.size).toBe(0);
});
it("uses the same deterministic named greeting for captions and speech", () => {
  const a: Arrival = {
    eventId: "a",
    displayName: "Jordan Smith",
    firstName: "Jordan",
  };
  expect(greetingFor(a)).toContain("Jordan");
  expect(greetingFor(a)).toBe(greetingFor({ ...a }));
});
