import { afterEach, expect, it, vi } from "vitest";
import { VoiceConnection } from "../client/src/voice";
import type { AudioEngine } from "../client/src/audio";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it.each(["", "airpods-device"])(
  "requests the selected input %s without silently falling back",
  async (id) => {
    const getUserMedia = vi
      .fn()
      .mockRejectedValue(new Error("Microphone unavailable"));
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    const error = vi.fn();
    const voice = new VoiceConnection(
      { stopRemote: vi.fn(), stopInput: vi.fn() } as unknown as AudioEngine,
      vi.fn(),
      error,
    );
    voice.microphoneId = id;
    await voice.connect();
    const constraints = getUserMedia.mock.calls[0][0];
    expect(constraints.audio.deviceId).toEqual(id ? { exact: id } : undefined);
    expect(error).toHaveBeenCalledWith("Microphone unavailable");
    expect(voice.status).toBe("error");
  },
);

function fixture() {
  const state = vi.fn();
  const error = vi.fn();
  const voice = new VoiceConnection({} as AudioEngine, state, error);
  const event = (e: unknown) => (voice as any).event(e);
  return { voice, state, error, event };
}

it("streams answer captions during playback, retains them briefly, and then hides them", () => {
  vi.useFakeTimers();
  const { voice, event } = fixture();
  event({ type: "response.created", response: { id: "r1" } });
  event({
    type: "response.output_audio_transcript.delta",
    response_id: "r1",
    delta: "Hey Jordan, ",
  });
  expect(voice.captionVisible).toBe(false);
  event({ type: "output_audio_buffer.started" });
  event({
    type: "response.output_audio_transcript.delta",
    response_id: "r1",
    delta: "try a baseline.",
  });
  event({
    type: "response.output_audio_transcript.done",
    response_id: "r1",
    transcript: "Hey Jordan, try a baseline.",
  });
  expect(voice.caption).toBe("Hey Jordan, try a baseline.");
  expect(voice.captionVisible).toBe(true);
  event({ type: "response.done", response: { status: "completed" } });
  vi.advanceTimersByTime(10000);
  expect(voice.captionVisible).toBe(true);
  event({ type: "output_audio_buffer.stopped" });
  vi.advanceTimersByTime(6499);
  expect(voice.captionVisible).toBe(true);
  vi.advanceTimersByTime(2);
  expect(voice.captionVisible).toBe(false);
});

it("clears interrupted captions and ignores late transcripts from the previous response", () => {
  const { voice, event } = fixture();
  event({ type: "response.created", response: { id: "old" } });
  event({
    type: "response.output_audio_transcript.delta",
    response_id: "old",
    delta: "Old answer",
  });
  event({ type: "output_audio_buffer.cleared" });
  event({
    type: "response.output_audio_transcript.done",
    response_id: "old",
    transcript: "Unheard continuation",
  });
  expect(voice.caption).toBe("");
  event({ type: "response.created", response: { id: "new" } });
  event({
    type: "response.output_audio_transcript.done",
    response_id: "old",
    transcript: "Stale answer",
  });
  expect(voice.caption).toBe("");
  event({
    type: "response.output_audio_transcript.done",
    response_id: "new",
    transcript: "Fresh answer",
  });
  expect(voice.caption).toBe("Fresh answer");
});

it("distinguishes detected speech from readiness and waits for playback to end", () => {
  const { voice, state, event } = fixture();
  event({ type: "input_audio_buffer.speech_started" });
  expect(voice.inputSpeaking).toBe(true);
  expect(voice.lastEvent).toContain("Speech detected");
  event({ type: "input_audio_buffer.speech_stopped" });
  expect(voice.inputSpeaking).toBe(false);
  expect(state).toHaveBeenLastCalledWith("thinking");
  event({ type: "response.created" });
  event({ type: "output_audio_buffer.started" });
  event({ type: "response.done", response: { status: "completed" } });
  expect(voice.busy).toBe(true);
  event({ type: "output_audio_buffer.stopped" });
  expect(voice.busy).toBe(false);
  expect(state).toHaveBeenLastCalledWith("listening");
});

it("reports failed responses instead of silently returning to listening", () => {
  const { voice, error, event } = fixture();
  event({ type: "response.created" });
  event({
    type: "response.done",
    response: {
      status: "failed",
      status_details: { error: { message: "Quota exceeded" } },
    },
  });
  expect(error).toHaveBeenCalledWith("Quota exceeded");
  expect(voice.lastEvent).toBe("Response failed");
  expect(voice.busy).toBe(false);
});

it("does not release a voice turn when previous playback stops during new speech", () => {
  const { voice, event } = fixture();
  event({ type: "input_audio_buffer.speech_started" });
  event({ type: "output_audio_buffer.cleared" });
  expect(voice.busy).toBe(true);
});

it("keeps paced captions across tool follow-ups while audio is still playing", () => {
  vi.useFakeTimers();
  const { voice, event } = fixture();
  event({ type: "response.created", response: { id: "intro" } });
  event({
    type: "response.output_audio_transcript.done",
    response_id: "intro",
    transcript: "Let me look that up for you.",
  });
  event({ type: "output_audio_buffer.started" });
  expect(voice.captionVisible).toBe(true);
  event({
    type: "response.done",
    response: { id: "intro", status: "completed" },
  });
  event({ type: "response.created", response: { id: "answer" } });
  event({
    type: "response.output_audio_transcript.done",
    response_id: "answer",
    transcript: "Start with a small baseline and compare your results.",
  });
  expect(voice.captionVisible).toBe(true);
  expect(voice.isPlaying).toBe(true);
  vi.advanceTimersByTime(3000);
  expect(voice.displayCaption).toContain("Start");
  vi.advanceTimersByTime(3000);
  expect(voice.displayCaption).toContain("results.");
  event({ type: "output_audio_buffer.stopped" });
  vi.advanceTimersByTime(6501);
  expect(voice.captionVisible).toBe(false);
});

it("retains captions until playback is actually interrupted", () => {
  const { voice, event } = fixture();
  event({ type: "response.created", response: { id: "r" } });
  event({
    type: "response.output_audio_transcript.done",
    response_id: "r",
    transcript: "Try a simple baseline first.",
  });
  event({ type: "output_audio_buffer.started" });
  event({ type: "input_audio_buffer.speech_started" });
  expect(voice.captionVisible).toBe(true);
  expect(voice.isPlaying).toBe(true);
  event({ type: "output_audio_buffer.cleared" });
  expect(voice.captionVisible).toBe(false);
  expect(voice.isPlaying).toBe(false);
});

it.each([false, true])(
  "mutes input through playback and preserves manual pause=%s",
  (manualPause) => {
    const { voice, event } = fixture();
    const track = { enabled: true };
    (voice as any).stream = { getAudioTracks: () => [track] };
    event({ type: "response.created", response: { id: "r" } });
    expect(track.enabled).toBe(false);
    event({ type: "output_audio_buffer.started" });
    voice.pause(manualPause);
    event({ type: "response.done", response: { status: "completed" } });
    expect(track.enabled).toBe(false);
    event({ type: "input_audio_buffer.speech_started" });
    expect(voice.inputSpeaking).toBe(false);
    expect(voice.isPlaying).toBe(true);
    event({ type: "output_audio_buffer.stopped" });
    expect(track.enabled).toBe(!manualPause);
    voice.pause(false);
    expect(track.enabled).toBe(true);
    event({ type: "input_audio_buffer.speech_started" });
    expect(voice.inputSpeaking).toBe(true);
  },
);

it("keeps input muted across tool work and restores it after a failed response", () => {
  const { voice, event } = fixture();
  const track = { enabled: true };
  (voice as any).stream = { getAudioTracks: () => [track] };
  event({ type: "response.created" });
  event({ type: "response.function_call_arguments.done" });
  event({ type: "response.done", response: { status: "completed" } });
  expect(track.enabled).toBe(false);
  event({ type: "response.created" });
  event({ type: "response.done", response: { status: "failed" } });
  expect(track.enabled).toBe(true);
});
