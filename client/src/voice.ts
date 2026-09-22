import { CaptionPacer } from "./captions";
import { api } from "./api";
import { AudioEngine } from "./audio";
import type { PandaState } from "../../shared/domain";
export class VoiceConnection {
  private pc?: RTCPeerConnection;
  private stream?: MediaStream;
  private channel?: RTCDataChannel;
  private generation = 0;
  busy = false;
  status = "disconnected";
  inputSpeaking = false;
  lastEvent = "Not connected";
  caption = "";
  private captionPrefix = "";
  private responseTranscript = "";
  get isPlaying() {
    return this.outputActive;
  }
  private captionResponseId: string | null = null;
  private captions = new CaptionPacer();
  get captionLines() {
    return this.captions.lines;
  }
  get displayCaption() {
    return this.captions.text;
  }
  get captionVisible() {
    return this.captions.visible;
  }
  private clearCaption() {
    this.caption = "";
    this.captionPrefix = this.responseTranscript = "";
    this.captions.reset();
    this.captionResponseId = null;
  }
  microphoneId = "";
  microphoneLabel = "Not connected";
  microphones: { deviceId: string; label: string }[] = [];
  private retries = 0;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private wanted = false;
  paused = false;
  private responseActive = false;
  private outputActive = false;
  private toolPending = false;
  constructor(
    private audio: AudioEngine,
    private state: (state: PandaState) => void,
    private error: (message: string) => void,
  ) {}
  async connect() {
    this.wanted = true;
    clearTimeout(this.retryTimer);
    this.closeLocal();
    const generation = ++this.generation;
    this.status = "connecting";
    this.lastEvent = "Connecting microphone";
    this.state("thinking");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(this.microphoneId
            ? { deviceId: { exact: this.microphoneId } }
            : {}),
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (generation !== this.generation) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      this.microphoneLabel =
        stream.getAudioTracks()[0]?.label || "Default microphone";
      this.audio.attachInput(stream);
      const devices = await navigator.mediaDevices
        .enumerateDevices()
        .catch(() => []);
      if (generation !== this.generation) return;
      this.microphones = devices
        .filter((d) => d.kind === "audioinput")
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || `Microphone ${i + 1}`,
        }));
      this.pause(this.paused);
      const pc = new RTCPeerConnection();
      this.pc = pc;
      for (const track of stream.getTracks()) pc.addTrack(track, stream);
      pc.ontrack = (e) => this.audio.attach(e.streams[0]);
      pc.onconnectionstatechange = () => {
        if (pc !== this.pc) return;
        if (pc.connectionState === "connected") {
          this.status = "connected";
          this.lastEvent = "Ready — no speech detected yet";
          this.retries = 0;
          this.state("listening");
        }
        if (["failed", "disconnected"].includes(pc.connectionState)) {
          this.status = "disconnected";
          this.busy = false;
          this.error("Voice disconnected. Reconnecting…");
          this.scheduleReconnect();
        }
      };
      const dc = pc.createDataChannel("oai-events");
      this.channel = dc;
      dc.onmessage = (message) => {
        if (pc !== this.pc) return;
        try {
          this.event(JSON.parse(message.data));
        } catch {
          this.error("Could not read voice event");
        }
      };
      await pc.setLocalDescription(await pc.createOffer());
      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === "complete") return resolve();
        const timer = setTimeout(resolve, 1500);
        pc.addEventListener("icegatheringstatechange", () => {
          if (pc.iceGatheringState === "complete") {
            clearTimeout(timer);
            resolve();
          }
        });
      });
      const { sdp } = await api("/realtime/session", {
        sdp: pc.localDescription?.sdp,
      });
      if (generation !== this.generation) return;
      await pc.setRemoteDescription({ type: "answer", sdp });
    } catch (e) {
      if (generation !== this.generation) return;
      this.closeLocal();
      this.status = "error";
      this.error(e instanceof Error ? e.message : "Voice unavailable");
      this.state("idle");
    }
  }
  private event(e: any) {
    switch (e.type) {
      case "input_audio_buffer.speech_started":
        if (this.responseActive || this.outputActive || this.toolPending) break;
        // Wait for confirmed playback interruption before discarding captions.
        // Microphone activity can be reported while the output buffer still plays.
        if (!this.outputActive) this.clearCaption();
        this.inputSpeaking = true;
        this.lastEvent = "Speech detected — waiting for a pause";
        this.busy = true;
        this.state("listening");
        break;
      case "input_audio_buffer.speech_stopped":
        if (this.responseActive || this.outputActive || this.toolPending) break;
        this.inputSpeaking = false;
        this.lastEvent = "Question ended — waiting for response";
        this.busy = true;
        this.state("thinking");
        break;
      case "response.function_call_arguments.done":
        this.toolPending = true;
        this.busy = true;
        break;
      case "response.created":
        // Tool follow-ups can be generated while the previous audio is playing.
        // Keep one paced queue for the spoken turn across those responses.
        if (!this.outputActive && !this.captions.visible) this.clearCaption();
        this.captionPrefix = this.caption ? this.caption.trimEnd() + " " : "";
        this.responseTranscript = "";
        this.captionResponseId = e.response?.id || null;
        this.lastEvent = "Generating response";
        this.toolPending = false;
        this.responseActive = true;
        this.busy = true;
        this.state("thinking");
        break;
      case "output_audio_buffer.started":
        this.lastEvent = "Playing response";
        this.captions.start();
        this.outputActive = true;
        this.busy = true;
        this.state("speaking");
        break;
      case "output_audio_buffer.stopped":
        this.captions.finish();
        this.outputActive = false;
        this.setIdle();
        break;
      case "output_audio_buffer.cleared":
        this.clearCaption();
        this.outputActive = false;
        this.setIdle();
        break;
      case "response.done":
        if (e.response?.status === "cancelled") this.clearCaption();
        if (e.response?.status === "failed") {
          this.clearCaption();
          const detail = e.response?.status_details?.error;
          this.lastEvent = "Response failed";
          this.error(
            detail?.message ||
              detail?.code ||
              "Voice response failed. Check API access/billing and reconnect voice.",
          );
        } else {
          this.lastEvent =
            e.response?.status === "cancelled"
              ? "Response interrupted"
              : "Response generated";
        }
        if (
          e.response?.status === "cancelled" ||
          e.response?.status === "failed"
        )
          this.toolPending = false;
        this.responseActive = false;
        this.setIdle();
        break;
      case "response.output_audio_transcript.delta":
        if (
          this.captionResponseId &&
          e.response_id === this.captionResponseId
        ) {
          this.responseTranscript += e.delta || "";
          this.caption = (this.captionPrefix + this.responseTranscript).slice(
            0,
            12000,
          );
          this.captions.update(this.caption);
        }
        break;
      case "response.output_audio_transcript.done":
        if (
          this.captionResponseId &&
          e.response_id === this.captionResponseId
        ) {
          this.responseTranscript = String(
            e.transcript || this.responseTranscript,
          );
          this.caption = (this.captionPrefix + this.responseTranscript).slice(
            0,
            12000,
          );
          this.captions.update(this.caption, true);
        }
        break;
      case "error":
        this.clearCaption();
        this.lastEvent = "Voice service error";
        this.error(e.error?.message || "Voice service error");
        this.toolPending = false;
        this.responseActive = false;
        this.outputActive = false;
        this.busy = false;
        this.state("listening");
        break;
    }
    this.syncMicrophone();
  }
  private setIdle() {
    if (
      !this.inputSpeaking &&
      !this.responseActive &&
      !this.outputActive &&
      !this.toolPending
    ) {
      this.busy = false;
      this.state("listening");
    }
  }
  private scheduleReconnect() {
    if (!this.wanted || this.retryTimer || this.retries >= 3) return;
    this.retryTimer = setTimeout(
      () => {
        this.retryTimer = undefined;
        this.retries++;
        void this.connect();
      },
      2000 * 2 ** this.retries,
    );
  }
  pause(value: boolean) {
    this.paused = value;
    this.syncMicrophone();
  }
  private syncMicrophone() {
    const enabled =
      !this.paused &&
      !this.responseActive &&
      !this.outputActive &&
      !this.toolPending;
    this.stream?.getAudioTracks().forEach((t) => (t.enabled = enabled));
  }
  private closeLocal() {
    this.clearCaption();
    this.pc?.close();
    this.pc = undefined;
    this.channel = undefined;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
    this.audio.stopRemote();
    this.audio.stopInput();
    this.microphoneLabel = "Not connected";
    this.busy = false;
    this.inputSpeaking = false;
    this.responseActive = false;
    this.outputActive = false;
    this.toolPending = false;
  }
  disconnect() {
    this.wanted = false;
    this.generation++;
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.closeLocal();
    this.status = "disconnected";
    void api("/realtime/disconnect", {}).catch(() => {});
  }
}
