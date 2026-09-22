import { afterEach, expect, it, vi } from "vitest";
import { CaptionPacer } from "../client/src/captions";
afterEach(() => vi.useRealTimers());
it("paces a transcript burst from playback start without skipping phrases", () => {
  vi.useFakeTimers();
  const p = new CaptionPacer();
  p.update(
    "One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen.",
    true,
  );
  expect(p.visible).toBe(false);
  p.start();
  expect(p.text).toBe("One two three four five six seven");
  vi.advanceTimersByTime(1000);
  expect(p.text).toBe("One two three four five six seven");
  vi.advanceTimersByTime(2000);
  expect(p.text).toBe("eight nine ten eleven twelve thirteen fourteen");
  p.finish();
  vi.advanceTimersByTime(3000);
  expect(p.text).toBe("fifteen.");
  expect(p.visible).toBe(true);
  vi.advanceTimersByTime(7000);
  expect(p.visible).toBe(false);
});
it("buffers incomplete words and clears queued text on interruption", () => {
  const p = new CaptionPacer();
  p.start();
  p.update("Try a base");
  expect(p.text).toBe("");
  p.update("Try a baseline.", true);
  expect(p.text).toBe("Try a baseline.");
  p.reset();
  expect(p.text).toBe("");
  expect(p.visible).toBe(false);
});

it("keeps earlier lines visible and starts a fresh block at a sentence boundary", () => {
  vi.useFakeTimers();
  const p = new CaptionPacer();
  const sentence =
    "One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone.";
  p.update(sentence + " Now start another sentence with useful advice.", true);
  p.start();
  expect(p.lines).toHaveLength(1);
  const first = p.lines[0];
  vi.advanceTimersByTime(3000);
  expect(p.lines).toHaveLength(2);
  expect(p.lines[0]).toBe(first);
  vi.advanceTimersByTime(3000);
  expect(p.lines).toHaveLength(3);
  expect(p.lines.map((line) => line.text).join(" ")).toBe(sentence);
  vi.advanceTimersByTime(3100);
  expect(p.lines).toHaveLength(1);
  expect(p.lines[0].text).toBe(
    "Now start another sentence with useful advice.",
  );
  p.reset();
  expect(p.lines).toEqual([]);
});
it("caps blocks at 35 words even without punctuation", () => {
  vi.useFakeTimers();
  const p = new CaptionPacer();
  p.update(Array.from({ length: 70 }, (_, i) => `word${i}`).join(" "), true);
  p.start();
  for (let i = 0; i < 10; i++) {
    expect(
      p.lines
        .map((line) => line.text)
        .join(" ")
        .split(" ").length,
    ).toBeLessThanOrEqual(35);
    vi.advanceTimersByTime(3000);
  }
});
