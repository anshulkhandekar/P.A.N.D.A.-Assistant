import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "./api";
import { IdleSprite } from "./IdleSprite";
import { ProjectorRuntime } from "./runtime";
import { CaptionPacer } from "./captions";
import {
  savePandaCustomization,
  usePandaCustomization,
  type PandaGlasses,
} from "./pandaCustomization";
import "./workshop.css";
type Snapshot = {
  title: string;
  session: string;
  phase: string;
  acceptingQuestions: boolean;
  questions: any[];
  playback: any;
  overlayConnected: boolean;
  discord: {
    status: string;
    error: string;
    configured: boolean;
    roles: string[];
  };
  speech: { native: boolean; openai: boolean };
};
const desktop = (window as any).pandaDesktop;
export function WorkshopConsole() {
  useEffect(() => {
    document.title = "Panda Admin Panel";
  }, []);
  const [s, setS] = useState<Snapshot>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [title, setTitle] = useState("ADSC workshop");
  const [name, setName] = useState("Jordan");
  const [text, setText] = useState(
    "Why does a high learning rate make training unstable?",
  );
  const [provider, setProvider] = useState("native");
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState("gpt-5.6-luna");
  const [search, setSearch] = useState(false);
  const customization = usePandaCustomization();
  useEffect(() => {
    let live = true;
    const refresh = () =>
      api("/workshop/status")
        .then((x) => {
          if (live) setS(x);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    void refresh();
    const t = setInterval(refresh, 1500);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  async function action(path: string, body: unknown = {}) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const x = await api("/workshop" + path, body);
      if (x.questions) setS(x);
      if (path === "/discord/register")
        setNotice(
          "/ask and /review are ready. Reopen Discord’s command picker to see the new fields.",
        );
      return x;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="workshop-console">
      <header>
        <h1>Panda Admin Panel</h1>
      </header>
      {error && (
        <p className="workshop-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <section>
        <h2>Workshop</h2>
        <label>
          Workshop title
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <div className="workshop-actions">
          <button
            disabled={busy || s?.phase !== "closed"}
            onClick={() => void action("/session", { action: "start", title })}
          >
            Start workshop
          </button>
          <button
            disabled={busy || !s || s.phase === "closed"}
            onClick={() => void action("/session", { action: "lecture" })}
          >
            Start lecture
          </button>
          <button
            disabled={busy || !s || s.phase === "closed"}
            onClick={() => void action("/session", { action: "end" })}
          >
            End workshop
          </button>
        </div>
        <p>
          <strong>{s?.phase || "Loading"}</strong>
        </p>
        <div className="workshop-actions">
          <span>Questions: {s?.acceptingQuestions ? "Open" : "Closed"}</span>
          <button
            disabled={busy || !s || s.phase === "closed"}
            onClick={() =>
              void action("/intake", { locked: !!s?.acceptingQuestions })
            }
          >
            {s?.acceptingQuestions ? "Lock questions" : "Unlock questions"}
          </button>
        </div>
        <a href="/admin" target="_blank">
          Greeting settings ↗
        </a>
      </section>
      <section>
        <h2>Panda</h2>
        <div className="panda-customizer">
          <div className="panda-customizer-preview" aria-label="Panda customization preview">
            <IdleSprite
              src="/assets/panda/typing-blink-v1.png"
              state="typing"
              volume={0}
              customization={customization}
              onError={() => {}}
            />
          </div>
          <div className="panda-customizer-fields">
            <label>
              Glasses
              <select
                value={customization.glasses}
                onChange={(e) =>
                  savePandaCustomization({
                    ...customization,
                    glasses: e.target.value as PandaGlasses,
                  })
                }
              >
                <option value="none">No glasses</option>
                <option value="classic">Classic black</option>
                <option value="money">Green money</option>
              </select>
            </label>
          </div>
        </div>
        <div className="workshop-actions">
          <button
            onClick={() =>
              desktop
                ? desktop.showOverlay()
                : window.open("/overlay", "panda-workshop-overlay")
            }
          >
            Show Panda
          </button>
          {desktop && (
            <>
              <button onClick={() => desktop.moveDisplay()}>
                Next display
              </button>
              <button onClick={() => desktop.resizePanda(-40)}>Smaller</button>
              <button onClick={() => desktop.resizePanda(40)}>Larger</button>
              <button onClick={() => desktop.toggleOverlay()}>
                Show / hide Panda
              </button>
            </>
          )}
          <label>
            Question voice
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
            >
              <option value="native">Mac voice</option>
              <option value="openai">OpenAI voice</option>
            </select>
          </label>
        </div>
        <p>{s?.overlayConnected ? "Audio ready" : "Enable audio on Panda"}</p>
        <button
          disabled={
            busy ||
            s?.phase !== "lecture" ||
            !!s?.playback ||
            !s?.overlayConnected
          }
          onClick={() => void action("/read", { provider })}
        >
          Read next question
        </button>{" "}
        <button onClick={() => void action("/stop")}>Stop speaking</button>
      </section>
      <section>
        <h2>Discord</h2>
        <p>
          Status: <strong>{s?.discord.status}</strong>. {s?.discord.error}
        </p>

        <div className="workshop-actions">
          <button
            disabled={
              busy ||
              !s?.discord.configured ||
              s.discord.status !== "disconnected"
            }
            onClick={() => void action("/discord/connect")}
          >
            Connect
          </button>
          <button
            disabled={busy || s?.discord.status !== "connected"}
            onClick={() => void action("/discord/register")}
          >
            Update commands
          </button>
          <button
            disabled={busy}
            onClick={() => void action("/discord/disconnect")}
          >
            Disconnect
          </button>
        </div>
      </section>
      <section>
        <h2>Questions</h2>

        {!s?.questions.length && <p>No questions.</p>}
        {s?.questions.map((q) => (
          <article className="question-card" key={q.id}>
            <div>
              <strong>{q.name}</strong>
              <span className="question-status">
                {q.status === "ended" ? "Workshop ended" : q.status}
              </span>
            </div>
            <p>{q.text}</p>
            <small>
              {q.author.startsWith("local-")
                ? "Local test"
                : `Discord: ${q.discord_username || "Member"} · ${q.author}${q.anonymous ? " · Name withheld from speech" : ""}`}
            </small>
            <div className="workshop-actions">
              {(q.status === "pending"
                ? ["approve", "deny"]
                : q.status === "approved"
                  ? ["first", "deny"]
                  : q.status === "read"
                    ? ["answered", "retry"]
                    : q.status === "interrupted"
                      ? ["retry"]
                      : []
              ).map((a) => (
                <button
                  key={a}
                  disabled={busy || s.phase === "closed"}
                  onClick={() =>
                    void action("/question/" + q.id, { action: a })
                  }
                >
                  {
                    (
                      {
                        approve: "Approve",
                        deny: "Deny",
                        first: "Move to front",
                        answered: "Mark answered",
                        retry: "Queue again",
                      } as any
                    )[a]
                  }
                </button>
              ))}
              <button
                onClick={() => {
                  setText(q.text);
                  setDraft("");
                }}
              >
                Draft answer
              </button>
            </div>
          </article>
        ))}
        <details>
          <summary>Test without Discord</summary>
          <label>
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
            />
          </label>
          <label>
            Question
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={600}
            />
          </label>
          <button
            disabled={busy || !s || s.phase === "closed"}
            onClick={() => void action("/sample", { name, text })}
          >
            Add local test question
          </button>
        </details>
      </section>
      <section>
        <h2>AI draft</h2>

        <label>
          Question
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={2000}
          />
        </label>
        <select
          aria-label="AI model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        >
          <option value="gpt-5.6-luna">Luna</option>
          <option value="gpt-5.6-sol">Sol</option>
          <option value="gpt-6-astra">Astra</option>
        </select>
        <label>
          <input
            type="checkbox"
            checked={search}
            onChange={(e) => setSearch(e.target.checked)}
          />{" "}
          Web search
        </label>
        <button
          disabled={busy || !s?.speech.openai}
          onClick={() =>
            void action("/draft", { question: text, model, search }).then(
              (x) => {
                if (x) setDraft(x.text);
              },
            )
          }
        >
          Generate answer
        </button>
        {draft && <p className="draft-answer">{draft}</p>}
      </section>
    </main>
  );
}
export function WorkshopStage() {
  const runtime = useRef<ProjectorRuntime | null>(null);
  runtime.current ||= new ProjectorRuntime();
  const r = runtime.current;
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState("");
  const [active, setActive] = useState<any>(null);
  const [, render] = useState(0);
  const id = useRef(crypto.randomUUID());
  const seen = useRef(new Set<string>());
  const playing = useRef<string | null>(null);
  const captions = useRef(new CaptionPacer());
  const customization = usePandaCustomization();
  const stage = useRef<HTMLElement>(null);
  const [size, setSize] = useState(() =>
    Math.max(
      160,
      Math.min(440, Number(localStorage.getItem("panda-size")) || 240),
    ),
  );
  const resize = (delta: number) =>
    setSize((n) => Math.max(160, Math.min(440, n + delta)));
  useEffect(() => desktop?.onResizePanda(resize), []);
  useLayoutEffect(() => {
    localStorage.setItem("panda-size", String(size));
    const element = stage.current;
    if (!element || !desktop) return;
    const update = () => {
      desktop.layoutOverlay(
        Math.max(340, size + 24),
        Math.ceil(element.getBoundingClientRect().height),
      );
      const areas = Array.from(
        element.querySelectorAll(
          ".overlay-panda,.overlay-caption,.overlay-greeting,button,.workshop-error",
        ),
      ).map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      desktop.setHitRegions(areas);
    };
    const observer = new ResizeObserver(update);
    observer.observe(element);
    update();
    return () => observer.disconnect();
  }, [size, enabled, error, !!r.greeting, captions.current.visible]);
  useEffect(() => {
    document.body.classList.add("overlay-body");
    r.start();
    const t = setInterval(() => render((n) => n + 1), 70);
    return () => {
      r.stop();
      clearInterval(t);
      document.body.classList.remove("overlay-body");
    };
  }, [r]);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    let pending = false;
    const poll = async () => {
      if (pending) return;
      pending = true;
      try {
        const s = await api("/workshop/overlay/claim", { id: id.current });
        if (!live) return;
        r.controls.autoGreet = s.phase === "arrivals";
        const p = s.playback;
        if (playing.current && p?.nonce !== playing.current) {
          playing.current = null;
          r.audio.stop();
          captions.current.reset();
          setActive(null);
        }
        if (p && !seen.current.has(p.nonce)) {
          seen.current.add(p.nonce);
          playing.current = p.nonce;
          setActive({ ...p, preparing: true });
          void (async () => {
            let ok = false;
            try {
              const response = await fetch("/api/workshop/audio/" + p.nonce, {
                headers: { "X-Overlay-Id": id.current },
              });
              if (!response.ok)
                throw Error(
                  "Speech could not be prepared. Retry the interrupted question from the console.",
                );
              const blob = await response.blob();
              if (!live || playing.current !== p.nonce) return;
              captions.current.reset();
              captions.current.update(p.text, true);
              captions.current.start();
              setActive({ ...p, preparing: false });
              await r.audio.play(blob, 120000);
              ok = playing.current === p.nonce;
            } catch (e) {
              if (live) setError((e as Error).message);
            } finally {
              if (live && playing.current === p.nonce) {
                captions.current.finish();
                playing.current = null;
                setActive(null);
                await api("/workshop/overlay/ack", {
                  id: id.current,
                  nonce: p.nonce,
                  ok,
                }).catch(() => {});
              }
            }
          })();
        }
      } catch (e) {
        if (live) {
          setError((e as Error).message);
          r.audio.stop();
          playing.current = null;
          setActive(null);
          captions.current.reset();
          setEnabled(false);
        }
      } finally {
        pending = false;
      }
    };
    void poll();
    const t = setInterval(() => void poll(), 1000);
    return () => {
      live = false;
      clearInterval(t);
      r.audio.stop();
    };
  }, [enabled, r]);
  const speaking = active ? !active.preparing : r.state === "speaking";
  return (
    <main
      ref={stage}
      className="workshop-stage"
      style={{ width: Math.max(340, size + 24) }}
    >
      {captions.current.visible && (
        <aside className="overlay-caption">
          {captions.current.lines.map((line) => (
            <p key={line.id}>{line.text}</p>
          ))}
        </aside>
      )}
      {r.greeting && (
        <p className="overlay-greeting">Welcome, {r.greeting.firstName}!</p>
      )}
      <div
        className="overlay-panda"
        title="Drag Panda to move"
        style={{ width: size, height: size }}
      >
        <div className="overlay-size-controls">
          <button
            aria-label="Make Panda smaller"
            onClick={() => resize(-40)}
            disabled={size <= 160}
          >
            −
          </button>
          <button
            aria-label="Make Panda larger"
            onClick={() => resize(40)}
            disabled={size >= 440}
          >
            +
          </button>
        </div>
        <IdleSprite
          cutout
          src="/assets/panda/typing-blink-v1.png"
          state={speaking ? "speaking" : "typing"}
          volume={r.audio.volume}
          greeting={!!r.greeting}
          customization={customization}
          onError={() => {}}
        />
      </div>
      {!enabled && (
        <button
          onClick={() =>
            void r.enable().then(() => {
              if (r.enabled) {
                setEnabled(true);
                setError("");
              } else setError(r.error);
            })
          }
        >
          Enable playback
        </button>
      )}
      {error && <p className="workshop-error">{error}</p>}
    </main>
  );
}
