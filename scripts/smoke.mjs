import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const port = 3037;
const child = spawn(process.execPath, ["dist/server/src/index.js"], {
  env: {
    ...process.env,
    PORT: String(port),
    DEMO_MODE: "true",
    OPENAI_API_KEY: "",
    ENABLE_GITHUB_ENRICHMENT: "false",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
const base = `http://127.0.0.1:${port}/api`;
const request = async (path, body, headers = {}) =>
  fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
try {
  await Promise.race([
    new Promise((resolve, reject) => {
      child.stdout.on("data", (data) => {
        if (String(data).includes("SERVER_READY")) resolve();
      });
      child.once("exit", (code) => reject(Error("Server exited " + code)));
      child.stderr.on("data", (data) => process.stderr.write(data));
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(Error("Startup timeout")), 8000),
    ),
  ]);
  const status = await (await request("/status")).json();
  assert.equal(status.demo, true);
  assert.equal(status.memberCount, 3);
  assert.equal(status.openaiConfigured, false);
  const abort = new AbortController();
  const stream = await fetch(base + "/events", { signal: abort.signal });
  const reader = stream.body.getReader();
  let output = "";
  const consume = (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        output += new TextDecoder().decode(value);
      }
    } catch {}
  })();
  const arrivals = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      request("/admin/simulateArrival", { name: "Test member " + i }),
    ),
  );
  const rows = await Promise.all(
    arrivals.map((r) => {
      assert.equal(r.status, 200);
      return r.json();
    }),
  );
  assert.equal(new Set(rows.map((r) => r.pandaCode)).size, 10);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal((output.match(/event: member_arrived/g) || []).length, 10);
  abort.abort();
  await consume;
  const clientId = randomUUID();
  assert.equal((await request("/projector/claim", { clientId })).status, 200);
  assert.equal(
    (await request("/projector/claim", { clientId: randomUUID() })).status,
    409,
  );
  assert.equal((await request("/controls", { mode: "invalid" })).status, 400);
  assert.equal(
    (
      await request(
        "/controls",
        { muted: true },
        { Origin: "https://evil.example" },
      )
    ).status,
    403,
  );
  assert.equal(
    (await request("/admin/action", { action: "select", code: "Panda 99" }))
      .status,
    404,
  );
  assert.equal(
    (await request("/admin/action", { action: "select", code: "Panda 1" }))
      .status,
    200,
  );
  assert.equal(
    (await request("/greeting/" + rows[0].eventId + "/audio")).status,
    502,
  );
  assert.equal(
    (
      await request(
        "/greeting/" + rows[0].eventId + "/ack",
        { outcome: "visual" },
        { "X-Projector-Id": clientId },
      )
    ).status,
    200,
  );
  assert.equal(
    (await request("/admin/action", { action: "clear" })).status,
    200,
  );
  const final = await (await request("/status")).json();
  assert.equal(final.attendeeCount, 10);
  assert.equal(final.controls.activeCode, "P1");
  assert.equal(JSON.stringify(final).includes("email_normalized"), false);
  console.log(
    "PASS: HTTP startup, 10 arrivals, SSE delivery, single audio lease, unknown code, privacy, origin/input validation, missing-key fallback, and acknowledgement.",
  );
} finally {
  child.kill("SIGTERM");
  await once(child, "exit");
}
