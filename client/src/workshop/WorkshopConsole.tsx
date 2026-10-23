import { useEffect, useState } from "react";
import { api } from "../api";
import { IdleSprite } from "../IdleSprite";
import {
  savePandaCustomization,
  usePandaCustomization,
  type PandaGlasses,
} from "../pandaCustomization";
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
const desktop = window.pandaDesktop;
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
          <div
            className="panda-customizer-preview"
            aria-label="Panda customization preview"
          >
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
