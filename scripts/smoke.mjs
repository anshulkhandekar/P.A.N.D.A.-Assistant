import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const port = 3037;
const dataDir = await mkdtemp(join(tmpdir(), "panda-smoke-"));
const child = spawn(process.execPath, ["dist/server/src/index.js"], {
  env: {
    ...process.env,
    PORT: String(port),
    DEMO_MODE: "true",
    OPENAI_API_KEY: "",
    ENABLE_DISCORD_QA: "false",
    ENABLE_AUTO_GREET: "true",
    PANDA_DATA_DIR: dataDir,
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
  assert.equal(status.attendeeCount, 0);
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
  assert.equal(new Set(rows.map((r) => r.eventId)).size, 10);
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
  assert.equal(JSON.stringify(final).includes("email_normalized"), false);
  console.log(
    "PASS: HTTP startup, 10 arrivals, SSE delivery, single audio lease, privacy, origin/input validation, missing-key fallback, and acknowledgement.",
  );
} finally {
  child.kill("SIGTERM");
  await once(child, "exit");
  await rm(dataDir, { recursive: true, force: true });
}
