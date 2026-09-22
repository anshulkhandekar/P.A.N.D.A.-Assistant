import type { PandaState } from "./domain.js";

export function mascotPose(
  state: PandaState,
  volume: number,
  reduced: boolean,
) {
  const speaking = state === "speaking";
  const thinking = state === "thinking" || state === "tool_using";
  const level = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0;
  return {
    typing: !speaking && state !== "new_arrival" && state !== "look_up",
    speaking,
    thinking,
    // A noise gate closes the mouth between words and when output is muted.
    mouthOpen:
      speaking && !reduced && level > 0.045
        ? Math.min(1, 0.22 + level * 1.4)
        : 0,
    gesture: reduced
      ? "rest"
      : thinking
        ? "think"
        : speaking
          ? "speak"
          : state === "new_arrival" || state === "look_up"
            ? "welcome"
            : "rest",
  };
}
