import { useEffect, useState, type CSSProperties } from "react";
import type { PandaState } from "../../shared/domain";
import { IdleSprite } from "./IdleSprite";
type Asset = {
  type: "image" | "video" | "sequence" | "idle-sprite";
  src?: string;
  frames?: string[];
  fps?: number;
};
export function Panda({
  state,
  volume,
  greeting = false,
}: {
  state: PandaState;
  volume: number;
  greeting?: boolean;
}) {
  const [assets, setAssets] = useState<Record<string, Asset>>({});
  const [failed, setFailed] = useState<string[]>([]);
  const [frame, setFrame] = useState(0);
  const canonical =
    state === "new_arrival" || state === "look_up"
      ? "listening"
      : state === "return_to_keyboard"
        ? "typing"
        : state === "tool_using"
          ? "thinking"
          : state;
  const asset = failed.includes(canonical) ? undefined : assets[canonical];
  useEffect(() => {
    fetch("/assets/panda/states.json")
      .then((r) => r.json())
      .then(setAssets)
      .catch(() => {});
  }, []);
  useEffect(() => {
    setFrame(0);
    if (asset?.type !== "sequence") return;
    const timer = setInterval(
      () => setFrame((n) => (n + 1) % (asset.frames?.length || 1)),
      1000 / (asset.fps || 12),
    );
    return () => clearInterval(timer);
  }, [asset]);
  const fail = () => setFailed((old) => [...old, canonical]);
  return (
    <div
      className={`panda-stage state-${canonical} ${asset ? "authored-animation" : "fallback-animation"}`}
      style={{ "--volume": volume } as CSSProperties}
    >
      <div className="mascot">
        {asset?.type === "idle-sprite" && asset.src ? (
          <IdleSprite
            src={asset.src}
            state={state}
            volume={volume}
            greeting={greeting}
            onError={fail}
          />
        ) : asset?.type === "video" ? (
          <video
            key={asset.src}
            src={asset.src}
            autoPlay
            muted
            loop
            playsInline
            onError={fail}
          />
        ) : (
          <img
            src={
              asset?.type === "sequence"
                ? asset.frames?.[frame]
                : asset?.src || "/assets/panda/logo.png"
            }
            alt="The ADSC panda working at a laptop"
            onError={asset ? fail : undefined}
          />
        )}
      </div>
    </div>
  );
}
