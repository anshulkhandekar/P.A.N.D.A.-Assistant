import { expect, it } from "vitest";
import { mascotPose } from "../shared/animation";

it("stops typing for a welcome, speaks only with output, then returns to typing", () => {
  expect(mascotPose("typing", 0, false).typing).toBe(true);
  expect(mascotPose("look_up", 0, false)).toMatchObject({
    typing: false,
    gesture: "welcome",
    mouthOpen: 0,
  });
  expect(mascotPose("speaking", 0.5, false).mouthOpen).toBeGreaterThan(0);
  expect(mascotPose("speaking", 0, false).mouthOpen).toBe(0);
  expect(mascotPose("return_to_keyboard", 0.8, false).mouthOpen).toBe(0);
});
it("keeps the mouth closed outside speech and respects reduced motion and invalid levels", () => {
  expect(mascotPose("thinking", 1, false)).toMatchObject({
    gesture: "think",
    mouthOpen: 0,
  });
  expect(mascotPose("speaking", 1, true)).toMatchObject({
    gesture: "rest",
    mouthOpen: 0,
  });
  expect(mascotPose("speaking", NaN, false).mouthOpen).toBe(0);
  expect(mascotPose("speaking", 50, false).mouthOpen).toBe(1);
});

it.each([
  "idle",
  "listening",
  "thinking",
  "tool_using",
  "return_to_keyboard",
] as const)("types instead of raising a hand while %s", (state) => {
  expect(mascotPose(state, 0, false).typing).toBe(true);
});
