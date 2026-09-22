import { describe, it, expect } from "vitest";
import {
  normalizeEmail,
  normalizePandaCode,
  findExistingMember,
  mergeProfile,
  allocateSequence,
  unseenEvents,
  GreetingQueue,
  githubUsername,
  hasConsent,
  type MemberProfile,
  type SignIn,
  type Arrival,
} from "../shared/domain.js";
import { MemberCache } from "../server/src/services/MemberCache.js";
const member = {
  member_id: "m1",
  email_normalized: "a@example.com",
  display_name: "Alex Doe",
  first_name: "Alex",
  github_url: "https://github.com/octocat",
  github_enrichment_consent: "false",
  major: "CS",
} as MemberProfile;
describe("identity safety", () => {
  it("normalizes email and matches returning members", () => {
    expect(normalizeEmail(" A@Example.com ")).toBe("a@example.com");
    expect(findExistingMember([member], " A@example.com ", "Other")).toBe(
      member,
    );
    expect(
      findExistingMember([member], "different@example.com", "Alex Doe"),
    ).toBeUndefined();
  });
  it("refuses ambiguous name fallbacks", () => {
    expect(
      findExistingMember(
        [member, { ...member, member_id: "m2" }],
        "",
        "Alex Doe",
      ),
    ).toBeUndefined();
  });
  it("preserves useful history and explicit opt-out", () => {
    expect(
      mergeProfile(member, { major: "", github_enrichment_consent: "false" }),
    ).toMatchObject({ major: "CS", github_enrichment_consent: "false" });
  });
  it.each([
    "Panda seventeen",
    "Panda 17",
    "P 17",
    "Panda number seventeen",
    "P17",
  ])("normalizes %s", (input) => expect(normalizePandaCode(input)).toBe("P17"));
  it.each([
    "Panda 0",
    "Panda 101",
    "Panda 17 or 18",
    "A1",
    "seventy cats",
    "Panda -1",
  ])("rejects %s", (input) => expect(normalizePandaCode(input)).toBeNull());
  it("supports 1–100", () => {
    for (let i = 1; i <= 100; i++)
      expect(normalizePandaCode("Panda " + i)).toBe("P" + i);
    expect(normalizePandaCode("Panda ninety-nine")).toBe("P99");
    expect(normalizePandaCode("Panda one hundred")).toBe("P100");
  });
  it("unknown code never returns another profile; revoked consent hides GitHub", () => {
    const cache = new MemberCache();
    cache.upsert(member);
    cache.arrive({ panda_code: "P1", member_id: "m1" } as SignIn);
    cache.github.set("m1", { secret: "old" });
    expect(cache.getMemberContext("P2")).toBeNull();
    expect(cache.getMemberContext("P1")?.github).toBeUndefined();
    expect(cache.getMemberContext("P1")).not.toHaveProperty("email_normalized");
  });
  it("prevents code reassignment", () => {
    const c = new MemberCache();
    c.upsert(member);
    c.upsert({ ...member, member_id: "m2" });
    c.arrive({ panda_code: "P1", member_id: "m1" } as SignIn);
    expect(() =>
      c.arrive({ panda_code: "P1", member_id: "m2" } as SignIn),
    ).toThrow();
  });
});
describe("event reliability", () => {
  it("allocates above existing sequence even with stale config", () => {
    expect(allocateSequence(1, [1, 2, 3])).toBe(4);
    expect(allocateSequence(4, [1, 2, 3])).toBe(4);
    expect(() => allocateSequence(101, [])).toThrow();
  });
  it("processes all arrivals in order and deduplicates", () => {
    const rows = [3, 1, 2, 2].map(
      (n) =>
        ({
          event_id: "e" + n,
          session_id: "s",
          session_sequence: String(n),
        }) as SignIn,
    );
    expect(
      unseenEvents(rows, new Set(["e1"]), "s").map((x) => x.event_id),
    ).toEqual(["e2", "e3"]);
    expect(unseenEvents(rows, new Set(), "other")).toEqual([]);
  });
  it("FIFO deduplicates reconnect replay and clears pending", () => {
    const q = new GreetingQueue();
    q.enqueue({ eventId: "a" } as Arrival);
    q.enqueue({ eventId: "b" } as Arrival);
    expect(q.enqueue({ eventId: "a" } as Arrival)).toBe(false);
    expect(q.shift()?.eventId).toBe("a");
    expect(q.shift()?.eventId).toBe("b");
    q.enqueue({ eventId: "c" } as Arrival);
    q.clear();
    expect(q.size).toBe(0);
  });
});
describe("GitHub opt-in", () => {
  it("accepts only profile URLs on github.com", () => {
    expect(githubUsername("github.com/octocat/")).toBe("octocat");
    for (const bad of [
      "https://github.com.evil.test/a",
      "http://github.com/a",
      "https://github.com/a/repo",
      "https://user@github.com/a",
      "javascript:alert(1)",
    ])
      expect(githubUsername(bad)).toBeNull();
  });
  it("false and missing consent prevent enrichment", () => {
    for (const c of ["false", "No", "", "maybe"])
      expect(hasConsent(c)).toBe(false);
    expect(hasConsent("TRUE")).toBe(true);
  });
});

it("keeps private survey details out of conversational context and labels historical interests", () => {
  const cache = new MemberCache();
  cache.upsert({
    ...member,
    learning_goals: "Python",
    dream_company: "Example",
    requested_topics: "Deployment",
    topic_comfort: "1",
    organization_membership: "Private org",
    mentorship_interest: "No",
    favorite_ice_cream: "Chocolate",
  });
  cache.arrive({ panda_code: "P1", member_id: "m1" } as SignIn);
  const context = cache.getMemberContext("P1");
  expect(context?.historicalInterests).toMatchObject({
    learningGoals: "Python",
    dreamCompany: "Example",
    requestedTopics: "Deployment",
  });
  expect(context).not.toHaveProperty("topic_comfort");
  expect(context).not.toHaveProperty("organization_membership");
  expect(JSON.stringify(context)).not.toContain("Private org");
});
