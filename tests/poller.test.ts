import { it, expect, vi } from "vitest";
import { SheetPoller } from "../server/src/services/SheetPoller.js";
import { MemberCache } from "../server/src/services/MemberCache.js";
import { EnrichmentQueue } from "../server/src/services/EnrichmentQueue.js";
import { env } from "../server/src/config/env.js";
import type { GoogleSheetsService } from "../server/src/services/GoogleSheetsService.js";
import type { MemberProfile } from "../shared/domain.js";
const m = {
  member_id: "m",
  email_normalized: "",
  display_name: "Jordan",
  first_name: "Jordan",
  github_enrichment_consent: "false",
  github_url: "https://github.com/octocat",
} as MemberProfile;
const row = (n: number) => ({
  event_id: "e" + n,
  session_id: env.SESSION_ID,
  session_sequence: String(n),
  panda_code: "P" + n,
  member_id: "m",
});
it("loads initial history silently, emits every new row sorted, and survives API errors", async () => {
  let events = [row(1)];
  let fail = false;
  const sheets = {
    snapshot: vi.fn(async () => {
      if (fail) throw Error("offline");
      return [[m], events];
    }),
  } as unknown as GoogleSheetsService;
  const cache = new MemberCache();
  const emit = vi.fn();
  const poller = new SheetPoller(sheets, cache, emit, () => {});
  await poller.refresh();
  expect(emit).not.toHaveBeenCalled();
  events = [row(1), row(3), row(2)];
  await poller.refresh();
  expect(emit.mock.calls.map((c) => c[0].pandaCode)).toEqual(["P2", "P3"]);
  await poller.refresh();
  expect(emit).toHaveBeenCalledTimes(2);
  fail = true;
  await poller.refresh();
  expect(cache.getMemberContext("P2")?.name).toBe("Jordan");
  expect(poller.lastError).toBe("offline");
  fail = false;
  events.push(row(4));
  await poller.refresh();
  expect(emit).toHaveBeenCalledTimes(3);
  expect(poller.lastError).toBeNull();
});
it("does not overlap concurrent refreshes", async () => {
  let release!: (value: any) => void;
  const snapshot = vi.fn(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const poller = new SheetPoller(
    { snapshot } as unknown as GoogleSheetsService,
    new MemberCache(),
    () => {},
    () => {},
  );
  const first = poller.refresh();
  const second = poller.refresh();
  expect(snapshot).toHaveBeenCalledTimes(1);
  release([[m], []]);
  await Promise.all([first, second]);
});
it("consent=false does not queue or fetch public GitHub data", () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  const cache = new MemberCache();
  cache.upsert(m);
  const queue = new EnrichmentQueue(cache);
  queue.enqueue(m);
  expect(queue.status.running).toBe(0);
  expect(queue.status.pending).toBe(0);
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
});
