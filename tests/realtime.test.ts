import { it, expect, vi } from "vitest";
vi.mock("../server/src/services/OpenAIService.js", () => ({
  searchCurrentInformation: vi.fn(async () => ({ facts: "Result" })),
}));
import { OpenAIRealtimeService } from "../server/src/services/OpenAIRealtimeService.js";
function fixture() {
  const service = new OpenAIRealtimeService(vi.fn());
  const sent: any[] = [];
  const internal = service as unknown as {
    ws: unknown;
    event: (e: unknown) => Promise<void>;
  };
  internal.ws = {
    readyState: 1,
    send: (data: string) => sent.push(JSON.parse(data)),
  };
  return { internal, sent };
}
const call = {
  type: "function_call",
  call_id: "c1",
  name: "search_current_information",
  arguments: JSON.stringify({ query: "Current workshops" }),
};
it("waits for response completion and executes a search only once", async () => {
  const { internal, sent } = fixture();
  await internal.event({
    ...call,
    type: "response.function_call_arguments.done",
  });
  expect(sent).toHaveLength(0);
  await internal.event({ type: "response.done", response: { output: [call] } });
  expect(sent.map((e) => e.type)).toEqual([
    "conversation.item.create",
    "response.create",
  ]);
  await internal.event({ type: "response.done", response: { output: [call] } });
  expect(sent).toHaveLength(2);
});
it("cancelled responses never trigger a follow-up", async () => {
  const { internal, sent } = fixture();
  await internal.event({
    type: "response.done",
    response: { status: "cancelled", output: [call] },
  });
  expect(sent).toHaveLength(0);
});
