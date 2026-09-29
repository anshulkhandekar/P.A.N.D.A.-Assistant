import { useEffect, useId, useState, type CSSProperties } from "react";
import type { PandaState } from "../../shared/domain";
import { mascotPose } from "../../shared/animation";
import type { PandaCustomization } from "./pandaCustomization";

// Fixed body/laptop from one PNG. Only clipped features and the live mouth move.
export function IdleSprite({
  src,
  state,
  volume,
  greeting = false,
  cutout = false,
  customization = { glasses: "none" },
  onError,
}: {
  src: string;
  state: PandaState;
  volume: number;
  greeting?: boolean;
  cutout?: boolean;
  customization?: PandaCustomization;
  onError: () => void;
}) {
  const id = useId().replace(/:/g, "");
  const [blink, setBlink] = useState(0);
  const [hands, setHands] = useState(0);
  const [smile, setSmile] = useState(false);
  const [toeBurst, setToeBurst] = useState(false);
  const [reduced, setReduced] = useState(false);
  const pose = mascotPose(state, volume, reduced);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let eyeTimer: ReturnType<typeof setTimeout>;
    let toeTimer: ReturnType<typeof setTimeout>;
    let handTimer: ReturnType<typeof setTimeout>;
    const start = () => {
      clearTimeout(eyeTimer);
      clearTimeout(handTimer);
      clearTimeout(toeTimer);
      setToeBurst(false);
      setBlink(0);
      setHands(0);
      setSmile(false);
      setReduced(preference.matches);
      if (preference.matches) return;
      const wiggle = () => {
        setToeBurst(true);
        toeTimer = setTimeout(() => {
          setToeBurst(false);
          toeTimer = setTimeout(wiggle, 2200 + Math.random() * 4200);
        }, 1100);
      };
      toeTimer = setTimeout(wiggle, 900 + Math.random() * 3000);
      const expressions = [
        [0, 3200],
        [1, 75],
        [2, 110],
        [1, 75],
        [0, 3500],
        [5, 550],
        [0, 1800],
      ];
      let eyeIndex = 0;
      const eyeTick = () => {
        const [frame, duration] = expressions[eyeIndex];
        setBlink(frame === 5 ? 0 : frame);
        setSmile(frame === 5);
        eyeTimer = setTimeout(() => {
          eyeIndex = (eyeIndex + 1) % expressions.length;
          eyeTick();
        }, duration);
      };
      eyeTick();
      if (
        state !== "speaking" &&
        state !== "new_arrival" &&
        state !== "look_up"
      ) {
        const pattern = [3, 4, 3, 4, 0, 3, 4, 0];
        let index = 0;
        const handTick = () => {
          const frame = pattern[index];
          setHands(frame);
          handTimer = setTimeout(
            () => {
              index = (index + 1) % pattern.length;
              handTick();
            },
            frame === 0 ? 650 : 180,
          );
        };
        handTick();
      }
    };
    start();
    preference.addEventListener("change", start);
    return () => {
      clearTimeout(eyeTimer);
      clearTimeout(handTimer);
      clearTimeout(toeTimer);
      setToeBurst(false);
      preference.removeEventListener("change", start);
    };
  }, [state]);
  const eyeFrame = reduced
    ? 0
    : blink || (smile && !pose.thinking ? 5 : pose.typing ? 3 : 0);
  // Clip only the raster layers, leaving moving SVG limbs free to animate.
  const silhouette = (frame: number) =>
    `M83 347 L61 266 Q59 257 69 258 L116 258 ${frame === 4 ? "Q116 231 128 222 Q150 206 174 228 L179 222" : "Q117 234 139 229 Q155 225 170 231 L179 222"} Q133 204 138 179 Q140 164 155 154 Q154 124 170 94 Q135 87 146 54 Q155 30 180 26 Q208 21 229 45 L254 38 Q254 10 282 7 Q313 3 331 24 Q345 39 348 60 Q388 83 414 142 Q454 236 458 292 L458 338 Q481 334 484 357 Q484 382 463 392 L438 395 Q401 451 329 478 Q266 503 237 486 Q226 481 221 448 L133 473 Q104 482 83 469 Q62 450 53 419 Q44 391 52 372 Q60 354 83 347 Z`;
  const tile = (frame: number) => (
    <g clipPath={cutout ? `url(#${id}-silhouette-${frame})` : undefined}>
      <image
        href={src}
        width={1536}
        height={1024}
        x={-(frame % 3) * 512}
        y={-Math.floor(frame / 3) * 512}
        onError={onError}
      />
    </g>
  );
  const rightHand = (
    <g
      fill="#fff"
      stroke="#000"
      strokeWidth="5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M220 255 Q219 230 246 230 Q275 228 278 255 Q254 267 220 255 Z" />
      <path
        d="M235 247 L233 257 M249 245 L248 259 M262 246 L263 257"
        fill="none"
        strokeWidth="3.5"
      />
    </g>
  );
  const eyewearTemples =
    customization.glasses === "none" ? null : (
      <g
        className={`panda-glasses-temples panda-glasses-${customization.glasses}`}
        transform={customization.glasses === "money" ? "translate(-8 0)" : undefined}
        fill="none"
        stroke={customization.glasses === "money" ? "#0b4f2b" : "#050505"}
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M155 137 Q148 132 143 127" />
        <path d="M319 138 Q349 132 377 113" />
      </g>
    );
  const eyewearFront =
    customization.glasses === "none" ? null : customization.glasses ===
      "classic" ? (
      <g
        className="panda-glasses panda-glasses-classic"
        fill="#fff"
        fillOpacity="0.14"
        stroke="#050505"
        strokeWidth="7"
      >
        <circle cx="190" cy="145" r="35" />
        <circle cx="284" cy="145" r="35" />
        <path d="M225 144 Q237 135 249 144" fill="none" />
      </g>
    ) : (
      <g className="panda-glasses panda-glasses-money" transform="translate(-8 0)">
        <path
          d="M151 117 Q188 99 226 119 L222 169 Q188 188 153 167 Z M247 119 Q284 99 322 117 L320 167 Q284 188 250 169 Z"
          fill="#2d9a57"
          stroke="#0b4f2b"
          strokeWidth="7"
          strokeLinejoin="round"
        />
        <path d="M225 139 Q237 132 249 139" fill="none" stroke="#0b4f2b" strokeWidth="7" />
        <text x="188" y="160" textAnchor="middle" fill="#d8ff77" fontFamily="Arial, sans-serif" fontSize="47" fontWeight="900">$</text>
        <text x="284" y="160" textAnchor="middle" fill="#d8ff77" fontFamily="Arial, sans-serif" fontSize="47" fontWeight="900">$</text>
      </g>
    );
  return (
    <svg
      viewBox={cutout ? "38 -4 460 506" : "0 0 512 512"}
      className={`idle-sprite rig-${greeting && !reduced ? "welcome" : pose.gesture} ${reduced ? "rig-reduced" : ""}`}
      role="img"
      aria-label={`ADSC panda ${state.replaceAll("_", " ")} at its laptop`}
      overflow="hidden"
      style={{ "--mouth-open": pose.mouthOpen } as CSSProperties}
    >
      <defs>
        {cutout &&
          Array.from({ length: 6 }, (_, frame) => (
            <clipPath key={frame} id={`${id}-silhouette-${frame}`}>
              <path d={silhouette(frame)} />
            </clipPath>
          ))}
        <mask
          id={`${id}-body`}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="512"
          height="512"
        >
          <rect width="512" height="512" fill="#fff" />
          <path d="M456 332 Q455 365 435 398 L502 404 L502 330 Z" fill="#000" />
        </mask>
        <clipPath id={`${id}-tail`}>
          <path d="M456 334 Q455 367 435 395 C460 399 482 383 484 361 Q485 336 456 334 Z" />
        </clipPath>
        <clipPath id={`${id}-nose`}>
          <rect x="190" y="168" width="48" height="24" />
        </clipPath>
        <clipPath id={`${id}-toes`}>
          <ellipse cx="104" cy="375" rx="35" ry="20" />
        </clipPath>
        <clipPath id={`${id}-frame`} clipPathUnits="userSpaceOnUse">
          <rect width="512" height="512" />
        </clipPath>
        <clipPath id={`${id}-eyes`}>
          <rect x="149" y="106" width="181" height="79" />
        </clipPath>
        <clipPath id={`${id}-hands`}>
          <rect x="107" y="211" width="215" height="51" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id}-frame)`}>
        <g mask={`url(#${id}-body)`}>{tile(0)}</g>
        <g className="rig-tail">
          <g clipPath={`url(#${id}-tail)`}>{tile(0)}</g>
        </g>
        <ellipse cx="104" cy="375" rx="35" ry="20" fill="#000" />
        <g className={`rig-toes ${toeBurst ? "is-wiggling" : ""}`}>
          <g clipPath={`url(#${id}-toes)`}>{tile(0)}</g>
        </g>
        <g clipPath={`url(#${id}-eyes)`}>{tile(eyeFrame)}</g>
        {eyewearTemples}
        {eyewearFront}
        {pose.typing && (
          <g clipPath={`url(#${id}-hands)`}>{tile(reduced ? 0 : hands)}</g>
        )}
        {!pose.typing && !reduced && (
          <g>
            {/* Reconstruct the black chest under the resting hand before lifting it. */}
            <path
              d="M218 261 Q214 226 247 226 Q281 225 282 261 Z"
              fill="#000"
            />
            <g className="rig-arm">
              <path
                d="M308 281 Q342 266 329 242"
                fill="none"
                stroke="#000"
                strokeWidth="29"
                strokeLinecap="round"
              />
              {greeting || pose.gesture === "welcome" ? (
                <g
                  fill="#fff"
                  stroke="#000"
                  strokeWidth="4"
                  strokeLinecap="round"
                >
                  <path d="M314 246 Q307 231 307 212 Q307 193 327 191 Q349 191 352 212 Q354 234 341 246 Z" />
                  <path
                    d="M319 200 L319 211 M330 198 L330 210 M341 202 L341 213"
                    fill="none"
                    strokeWidth="3"
                  />
                </g>
              ) : (
                <g transform="translate(80 -15)">{rightHand}</g>
              )}
            </g>
            {/* Keep the laptop edge in front of the arm. */}
            <path d="M217 261 L282 261" stroke="#000" strokeWidth="5" />
          </g>
        )}
        {pose.speaking && (
          <g className="rig-mouth">
            {/* Preserve the nose; replace only the small tongue beneath it. */}
            <rect x="199" y="188" width="35" height="24" rx="5" fill="#fff" />
            <g clipPath={`url(#${id}-nose)`}>{tile(0)}</g>
            {pose.mouthOpen > 0 ? (
              <g transform="translate(214 214)">
                <g className="rig-mouth-opening">
                  <ellipse rx="10" ry="8" fill="#000" />
                  <path
                    d="M-5 5 Q0 2 5 5"
                    fill="none"
                    stroke="#fff"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </g>
              </g>
            ) : (
              <path
                d="M204 211 Q214 220 223 211"
                fill="none"
                stroke="#000"
                strokeWidth="3"
                strokeLinecap="round"
              />
            )}
          </g>
        )}
      </g>
    </svg>
  );
}
