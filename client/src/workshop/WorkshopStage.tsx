import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "../api";
import { IdleSprite } from "../IdleSprite";
import { ProjectorRuntime } from "../runtime";
import { CaptionPacer } from "../captions";
import { usePandaCustomization } from "../pandaCustomization";

const desktop = window.pandaDesktop;

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
