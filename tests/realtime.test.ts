import { it, expect, vi } from "vitest";
import { OpenAIRealtimeService } from "../server/src/services/OpenAIRealtimeService.js";
import { MemberCache } from "../server/src/services/MemberCache.js";
import type { MemberProfile, SignIn } from "../shared/domain.js";
function fixture() {
  const cache = new MemberCache();
  cache.upsert({
    member_id: "j",
    display_name: "Jordan Smith",
    first_name: "Jordan",
    email_normalized: "private@example.com",
    github_url: "",
    github_enrichment_consent: "false",
  } as MemberProfile);
  cache.arrive({ member_id: "j", panda_code: "P1" } as SignIn);
  const onCode = vi.fn();
  const service = new OpenAIRealtimeService(cache, vi.fn(), onCode);
  const sent: any[] = [];
  const internal = service as unknown as {
    ws: unknown;
    event: (e: unknown) => Promise<void>;
  };
  internal.ws = {
    readyState: 1,
    send: (data: string) => sent.push(JSON.parse(data)),
  };
  return { internal, sent, onCode };
}
const call = (id: string, code: string) => ({
  type: "function_call",
  call_id: id,
  name: "lookup_member",
  arguments: JSON.stringify({ panda_code: code }),
});
it("waits for response.done, executes lookup once, then requests one response", async () => {
  const { internal, sent, onCode } = fixture();
  await internal.event({
    ...call("c1", "P1"),
    type: "response.function_call_arguments.done",
  });
  expect(sent).toHaveLength(0);
  await internal.event({
    type: "response.done",
    response: { output: [call("c1", "P1")] },
  });
  expect(onCode).toHaveBeenLastCalledWith("P1");
  expect(sent.map((e) => e.type)).toEqual([
    "conversation.item.create",
    "response.create",
  ]);
  expect(sent[0].item.output).not.toContain("private@example.com");
  await internal.event({
    type: "response.done",
    response: { output: [call("c1", "P1")] },
  });
  expect(sent).toHaveLength(2);
});
it("unknown and malformed lookups clear previous identity and private context", async () => {
  const { internal, sent, onCode } = fixture();
  await internal.event({
    type: "response.done",
    response: { output: [call("c1", "P1")] },
  });
  await internal.event({
    type: "response.done",
    response: { output: [call("c2", "P99")] },
  });
  expect(onCode).toHaveBeenLastCalledWith(null);
  expect(
    sent.some(
      (e) => e.type === "conversation.item.delete" && e.item_id === "tool_c1",
    ),
  ).toBe(true);
  await internal.event({
    type: "response.done",
    response: { output: [{ ...call("c3", "P1"), arguments: "bad json" }] },
  });
  expect(onCode).toHaveBeenLastCalledWith(null);
});
it("cancelled tool responses never inject stale context", async () => {
  const { internal, sent } = fixture();
  await internal.event({
    type: "response.done",
    response: { status: "cancelled", output: [call("c1", "P1")] },
  });
  expect(sent).toHaveLength(0);
});
