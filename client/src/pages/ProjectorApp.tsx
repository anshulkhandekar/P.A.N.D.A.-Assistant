import { greetingFor } from "../../../shared/domain";
import React, { useEffect, useState } from "react";
import { Panda } from "../Panda";
import { ProjectorRuntime } from "../runtime";
import { api } from "../api";
import type { PandaState } from "../../../shared/domain";

const isAdmin = location.pathname === "/admin";
if (!isAdmin) window.name = "panda-stage";
const workshopPage = ["/workshop", "/overlay"].includes(location.pathname);
const runtime = isAdmin || workshopPage ? null : new ProjectorRuntime();
const labels: Record<PandaState, string> = {
  idle: "Idle",
  typing: "Typing",
  new_arrival: "Welcoming",
  look_up: "Welcoming",
  listening: "Listening",
  thinking: "Thinking",
  tool_using: "Searching",
  speaking: "Speaking",
  return_to_keyboard: "Typing",
};
function ClubHeader() {
  return (
    <header className="club-header">
      <img src="/assets/club/logo.png" alt="Aggie Data Science Club" />
    </header>
  );
}
function useStatus() {
  const [status, setStatus] = useState<any>(null);
  useEffect(() => {
    let live = true;
    const refresh = () =>
      api("/status")
        .then((s) => {
          if (live) setStatus(s);
        })
        .catch(() => {
          if (live)
            setStatus((previous: any) => ({
              ...previous,
              serverOffline: true,
            }));
        });
    void refresh();
    const timer = setInterval(refresh, 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  return status;
}
export function ProjectorApp() {
  const status = useStatus();
  const [, render] = useState(0);
  useEffect(() => {
    runtime?.start();
    const timer = setInterval(() => render((x) => x + 1), 70);
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement
      )
        return;
      if (e.key.toLowerCase() === "f")
        void document.documentElement.requestFullscreen().catch(() => {});
      if (e.key.toLowerCase() === "a") window.open("/admin", "panda-admin");
      if (e.key === "Escape") void api("/controls", { micPaused: true });
    };
    window.addEventListener("keydown", onKey);
    return () => {
      runtime?.stop();
      clearInterval(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  if (isAdmin) return <Admin status={status} />;
  const r = runtime!;
  const state =
    r.controls.forcedState ||
    (!r.greeting && r.voice.isPlaying ? "speaking" : r.state);
  // Silent rehearsal only; actual welcomes and Q&A always use measured output audio.
  const rehearsal =
    r.controls.forcedState === "speaking" &&
    !r.voice.busy &&
    !r.greeting &&
    !r.controls.muted;
  const previewPhase = Date.now() % 2400;
  const mascotVolume = rehearsal
    ? previewPhase < 1700
      ? Math.max(0, Math.sin(previewPhase / 110)) * 0.7
      : 0
    : r.audio.volume;
  const captionVisible = !r.greeting && (r.voice.captionVisible || rehearsal);
  const previewLines = [
    "Start with one small project",
    "and a simple baseline.",
    "Give your model something useful to beat",
    "before you give it a victory parade.",
  ];
  const captionLines =
    rehearsal && !r.voice.captionVisible
      ? previewLines
          .slice(0, (Math.floor(Date.now() / 2800) % 4) + 1)
          .map((text, id) => ({ id, text }))
      : r.voice.captionLines;
  return (
    <main className="projector" aria-label="P.A.N.D.A. workshop stage">
      <ClubHeader />
      <section className="scene" aria-label="Club mascot">
        <aside
          className={`speech-caption ${captionVisible ? "is-visible" : ""}`}
          aria-label="Panda's spoken answer"
          aria-hidden={!captionVisible}
        >
          <span className="caption-label">
            {rehearsal && !r.voice.captionVisible
              ? "Caption preview"
              : "P.A.N.D.A. says"}
          </span>
          <div className="caption-lines">
            {captionLines.map((line) => (
              <p key={line.id}>{line.text}</p>
            ))}
          </div>
        </aside>
        <Panda state={state} volume={mascotVolume} greeting={!!r.greeting} />
        <div className="status-pill" role="status" aria-live="polite">
          <span className="state-dot" aria-hidden="true" />
          {r.controls.micPaused &&
          r.controls.mode === "qa" &&
          !r.voice.busy &&
          !r.greeting
            ? "Microphone paused"
            : !r.controls.forcedState && state === "listening" && !r.voice.busy
              ? "Ready for a question"
              : labels[state]}
        </div>
        <div className="greeting-caption" aria-live="polite">
          {r.greeting && (
            <div className="welcome-card" key={r.greeting.eventId}>
              <span className="welcome-spark" aria-hidden="true">
                ✦
              </span>
              <span>
                <strong>{greetingFor(r.greeting)}</strong>
              </span>
              <span className="welcome-spark" aria-hidden="true">
                ✦
              </span>
            </div>
          )}
        </div>
      </section>
      {!r.enabled && (
        <div className="stage-start">
          <button onClick={() => void r.enable()}>Enable stage audio</button>
          {r.error && <p role="alert">{r.error}</p>}
        </div>
      )}
      <small className="disclosure">AI-generated speech</small>
    </main>
  );
}

function Admin({ status }: { status: any }) {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [name, setName] = useState("Jordan Smith");
  const [busy, setBusy] = useState(false);
  async function run(path: string, body: unknown) {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await api(path, body);
      setNotice("Done. The stage will update automatically.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }
  const control = (body: unknown) => run("/controls", body);
  const action = (action: string) => run("/admin/action", { action });
  return (
    <main className="admin">
      <header className="admin-header">
        <a href="/" target="panda-stage" className="wordmark">
          P.A.N.D.A.<span className="wordmark-star">✳</span>
        </a>
        <div>
          <div className="eyebrow">BACKSTAGE</div>
          <h1>
            A little control.
            <br />
            <em>A lot of personality.</em>
          </h1>
        </div>
        <a className="text-link" href="/" target="panda-stage">
          Open projector ↗
        </a>
      </header>
      {status?.serverOffline && (
        <p className="warning" role="alert">
          Server connection lost. Values below may be stale; restart the local
          server.
        </p>
      )}
      <div className="admin-notice">
        Keep this window on your laptop. Only the projector window plays audio.{" "}
        {status?.demo
          ? "Demo mode uses simulated arrivals; Google is disconnected."
          : "Live mode reads your Form response sheet."}
      </div>
      <div className="admin-grid">
        <section className="panel">
          <h2>
            <span>01</span> Run the room
          </h2>
          <div className="segmented">
            <button
              className={status?.controls.mode === "arrival" ? "selected" : ""}
              onClick={() => void control({ mode: "arrival" })}
            >
              Arrival mode
            </button>
            <button
              className={status?.controls.mode === "qa" ? "selected" : ""}
              onClick={() => void control({ mode: "qa" })}
            >
              Q&A mode
            </button>
          </div>
          <p className="hint">
            Arrivals welcome people one at a time. In Q&A, late greetings wait
            until the conversation is idle.
          </p>
          <div className="button-grid">
            <label>
              Greeting voice
              <select
                disabled={busy || !status}
                value={status?.controls.greetingVoice || ""}
                onChange={(e) =>
                  void control({ greetingVoice: e.target.value })
                }
              >
                {status?.voiceOptions?.greeting.map((voice: string) => (
                  <option key={voice} value={voice}>
                    {voice}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Q&A voice
              <select
                disabled={busy || !status}
                value={status?.controls.responseVoice || ""}
                onChange={(e) =>
                  void control({ responseVoice: e.target.value })
                }
              >
                {status?.voiceOptions?.response.map((voice: string) => (
                  <option key={voice} value={voice}>
                    {voice}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="hint">
            Greeting changes apply to the next welcome requested. Changing Q&A
            voice reconnects and resets the conversation; change it between
            speakers. Choices last until the server restarts; .env sets the
            startup defaults. Try marin or cedar for both.
          </p>
          <div className="button-grid">
            <label>
              Microphone input
              <select
                value={status?.controls.microphoneId || ""}
                onChange={(e) => void control({ microphoneId: e.target.value })}
              >
                <option value="">System default</option>
                {status?.telemetry.microphones
                  ?.filter((m: any) => m.deviceId && m.deviceId !== "default")
                  .map((m: any) => (
                    <option key={m.deviceId} value={m.deviceId}>
                      {m.label}
                    </option>
                  ))}
              </select>
              <small>
                Enter Q&A and allow microphone access on the projector to list
                inputs. Changing input reconnects voice.
              </small>
            </label>
            <button
              onClick={() =>
                void control({ micPaused: !status?.controls.micPaused })
              }
            >
              {status?.controls.micPaused
                ? "Resume microphone"
                : "Pause microphone"}
            </button>
            <button
              onClick={() => void control({ muted: !status?.controls.muted })}
            >
              {status?.controls.muted ? "Unmute panda" : "Mute panda"}
            </button>
            <button onClick={() => void action("reconnect")}>
              Reconnect voice
            </button>
            <button onClick={() => void action("end_exchange")}>
              New speaker / reset
            </button>
            <button onClick={() => void action("clear")}>
              Clear greetings
            </button>
            <button onClick={() => void action("replay")}>
              Replay last welcome
            </button>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={status?.controls.autoGreet ?? true}
              onChange={(e) => void control({ autoGreet: e.target.checked })}
            />{" "}
            Automatically greet arrivals
          </label>
        </section>
        <section className="panel">
          <h2>
            <span>02</span> Read the room
          </h2>
          <div className="metrics">
            <div>
              <b>{status?.attendeeCount ?? "—"}</b>
              <small>CHECKED IN</small>
            </div>
            <div>
              <b>{status?.pendingGreetings ?? 0}</b>
              <small>IN THE QUEUE</small>
            </div>
          </div>
          <dl className="health">
            <dt>Projector</dt>
            <dd>
              {status?.projectorConnected
                ? "Audio enabled"
                : "Waiting for Enable stage audio"}
            </dd>
            <dt>OpenAI</dt>
            <dd>
              {status?.openaiConfigured
                ? "Key configured · " + status.voice
                : "API key needed for speech"}
            </dd>
            <dt>Sheets</dt>
            <dd>
              {status?.demo
                ? "Demo / disconnected"
                : status?.sheetsError ||
                  (status?.lastSheetsSync
                    ? "Synced " +
                      new Date(status.lastSheetsSync).toLocaleTimeString()
                    : "Waiting for first sync")}
            </dd>
            <dt>Response tab</dt>
            <dd>{status?.greetingSource?.sheet}</dd>
            <dt>Name column</dt>
            <dd>{status?.greetingSource?.nameHeader}</dd>
            <dt>Stage state</dt>
            <dd>{status?.telemetry.state || "Waiting"}</dd>
            <dt>Last voice event</dt>
            <dd>{status?.telemetry.voiceEvent || "Not connected"}</dd>
            <dt>Active microphone</dt>
            <dd>{status?.telemetry.microphoneLabel || "Not connected"}</dd>
            <dt>Microphone signal</dt>
            <dd>
              <meter
                min={0}
                max={1}
                value={status?.telemetry.inputLevel || 0}
                aria-label="Recent microphone signal"
              />{" "}
              Recent peak · updates every few seconds
            </dd>
            <dt>Greetings</dt>
            <dd>
              {status?.projectorConnected
                ? status?.telemetry.greetingStatus
                : "Enable audio on the projector"}
            </dd>
          </dl>
          {status?.telemetry.error && (
            <p className="warning">{status.telemetry.error}</p>
          )}
          <button onClick={() => void action("refresh")}>
            Refresh sign-ins
          </button>
        </section>
        <section className="panel">
          <h2>
            <span>03</span> Cue a welcome
          </h2>
          {status?.demo ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run("/admin/simulateArrival", {
                  name,
                });
              }}
            >
              <label>
                Display name
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                  required
                />
              </label>
              <button className="primary" disabled={busy}>
                Simulate arrival ↗
              </button>
            </form>
          ) : (
            <p className="hint">
              Submit your live Google Form after Sheets shows Synced. Use Replay
              last welcome to greet the last arrival again.
            </p>
          )}
          <div className="mini-note">
            Simulated arrivals never write to Google Sheets.
          </div>
        </section>
        <section className="panel">
          <h2>
            <span>04</span> A helping hand
          </h2>
          <label>
            Animation rehearsal
            <select
              value={status?.controls.forcedState || ""}
              onChange={(e) =>
                void control({ forcedState: e.target.value || null })
              }
            >
              <option value="">Automatic / follow audio</option>
              {[
                "idle",
                "typing",
                "new_arrival",
                "look_up",
                "listening",
                "thinking",
                "tool_using",
                "speaking",
                "return_to_keyboard",
              ].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <p className="hint">
            Speaking rehearsal includes a silent mouth-motion preview. Return to
            Automatic for live use. Voice requires a configured OpenAI key.
            Press F on the stage for fullscreen; Esc pauses the microphone.
          </p>
        </section>
      </div>
      <div className="action-status" role="status">
        {error ? <span className="warning">{error}</span> : notice}
      </div>
      <footer className="admin-footer">
        AGGIE DATA SCIENCE CLUB{" "}
        <span>P.A.N.D.A. OPERATOR CONSOLE · LOCAL ACCESS ONLY</span>
      </footer>
    </main>
  );
}
