import {
  GreetingQueue,
  type Arrival,
  type Controls,
  type PandaState,
} from "../../shared/domain";
import { AudioEngine } from "./audio";
import { VoiceConnection } from "./voice";
import { api, clientId } from "./api";
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export class ProjectorRuntime {
  queue = new GreetingQueue();
  audio = new AudioEngine();
  voice: VoiceConnection;
  controls: Controls = {
    mode: "arrival",
    muted: false,
    micPaused: false,
    autoGreet: true,
    forcedState: null,
    activeCode: null,
  };
  state: PandaState = "typing";
  greeting: Arrival | null = null;
  enabled = false;
  error = "";
  sseConnected = false;
  private owns = false;
  private draining = false;
  private source?: EventSource;
  private timer?: ReturnType<typeof setInterval>;
  private playing = false;
  private renewAt = 0;
  private seenPlayed = new Set<string>();
  private clearEpoch = 0;
  private lastIdle = Date.now();
  private greetingAbort?: AbortController;
  private reconnectAfterGreeting = false;
  get greetingStatus() {
    if (!this.enabled || !this.owns) return "Enable audio on the projector";
    if (this.playing) return "Playing a welcome";
    if (!this.controls.autoGreet) return "Automatic greetings are off";
    if (!this.queue.size) return "No greetings waiting";
    if (this.voice.status === "connecting")
      return "Waiting for voice connection";
    if (this.voice.busy) return "Waiting for the current voice turn";
    return "Ready — Q&A waits for three seconds of idle time";
  }
  constructor() {
    this.voice = new VoiceConnection(
      this.audio,
      (state) => {
        this.state = state;
        this.lastIdle = Date.now();
      },
      (message) => {
        this.error = message;
      },
    );
  }
  start() {
    this.source = new EventSource("/api/events");
    this.source.onopen = () => {
      this.sseConnected = true;
    };
    this.source.onerror = () => {
      this.sseConnected = false;
    };
    this.source.addEventListener("controls", (event) => {
      const previous = this.controls.mode;
      const previousMicrophone = this.controls.microphoneId || "";
      const previousVoice = this.controls.responseVoice;
      this.controls = JSON.parse(event.data);
      this.voice.microphoneId = this.controls.microphoneId || "";
      this.audio.setMuted(this.controls.muted);
      this.voice.pause(this.controls.micPaused || this.playing);
      if (
        previous !== this.controls.mode ||
        previousMicrophone !== this.voice.microphoneId ||
        previousVoice !== this.controls.responseVoice
      ) {
        if (this.controls.mode === "arrival") {
          this.voice.disconnect();
          if (!this.playing) this.state = "typing";
        } else if (this.enabled) {
          if (this.playing) this.reconnectAfterGreeting = true;
          else void this.voice.connect();
        }
      }
    });
    this.source.addEventListener("member_arrived", (event) => {
      const a = JSON.parse(event.data);
      if (!this.seenPlayed.has(a.eventId)) this.queue.enqueue(a);
    });
    this.source.addEventListener("voice_state", (event) => {
      if (!this.playing) this.state = JSON.parse(event.data).state;
    });
    this.source.addEventListener("voice_error", (event) => {
      this.error = JSON.parse(event.data).message;
    });
    this.source.addEventListener("command", (event) => {
      const { action } = JSON.parse(event.data);
      if (action === "clear") {
        this.queue.clear();
        this.clearEpoch++;
        this.greetingAbort?.abort();
        this.audio.stop();
      }
      if (action === "reconnect" && this.enabled && this.controls.mode === "qa")
        void this.voice.connect();
    });
    this.timer = setInterval(() => {
      void this.tick();
    }, 300);
  }
  async enable() {
    try {
      await this.audio.unlock();
      await api("/projector/claim", { clientId });
      this.owns = true;
      this.enabled = true;
      this.renewAt = Date.now() + 4000;
      this.error = "";
      if (this.controls.mode === "qa") await this.voice.connect();
    } catch (e) {
      this.error = e instanceof Error ? e.message : "Audio could not start";
    }
  }
  private async tick() {
    if (!this.enabled || !this.owns) return;
    if (Date.now() > this.renewAt) {
      this.renewAt = Date.now() + 4000;
      try {
        await api("/projector/claim", { clientId });
        await api("/projector/telemetry", {
          state: this.state,
          queue: this.queue.size,
          audioEnabled: this.enabled,
          voice: this.voice.status,
          error: this.error.slice(0, 200),
          voiceEvent: this.voice.lastEvent,
          greetingStatus: this.greetingStatus,
          microphoneLabel: this.voice.microphoneLabel,
          microphones: this.voice.microphones,
          inputLevel: this.audio.takeInputPeak(),
        });
      } catch {
        this.owns = false;
        this.enabled = false;
        this.audio.stop();
        this.voice.disconnect();
        this.error = "Lost connection to the server. Enable the stage again.";
        return;
      }
    }
    if (
      !this.draining &&
      this.controls.autoGreet &&
      this.queue.size &&
      !this.voice.busy &&
      this.voice.status !== "connecting" &&
      (this.controls.mode === "arrival" || Date.now() - this.lastIdle > 3000)
    )
      void this.drain();
  }
  private async drain() {
    this.draining = true;
    const a = this.queue.shift();
    if (!a) {
      this.draining = false;
      return;
    }
    this.playing = true;
    this.voice.pause(true);
    this.greeting = a;
    const epoch = this.clearEpoch;
    let outcome = "visual";
    this.state = "new_arrival";
    // Begin synthesis during the look-up animation to hide network latency.
    this.greetingAbort = new AbortController();
    const audio = fetch(
      "/api/greeting/" + encodeURIComponent(a.eventId) + "/audio",
      {
        signal: AbortSignal.any([
          this.greetingAbort.signal,
          AbortSignal.timeout(20000),
        ]),
      },
    )
      .then(async (res) => {
        if (!res.ok)
          throw Error("Greeting audio unavailable; visual welcome shown.");
        return res.blob();
      })
      .then((blob) => ({ blob, error: null }))
      .catch((error) => ({ blob: null, error }));
    try {
      await delay(300);
      this.state = "look_up";
      await delay(450);
      const result = await audio;
      if (epoch === this.clearEpoch && this.enabled) {
        this.state = "speaking";
        if (result.blob && !this.controls.muted) {
          await this.audio.play(result.blob);
          outcome = epoch === this.clearEpoch ? "audio" : "cancelled";
        } else {
          if (result.error) this.error = result.error.message;
          await delay(1600);
        }
      }
      this.state = "return_to_keyboard";
      await delay(400);
    } catch (e) {
      this.error = e instanceof Error ? e.message : "Greeting failed";
    } finally {
      this.greetingAbort = undefined;
      this.seenPlayed.add(a.eventId);
      void api("/greeting/" + encodeURIComponent(a.eventId) + "/ack", {
        outcome,
      }).catch(() => {});
      this.greeting = null;
      this.playing = false;
      this.voice.pause(this.controls.micPaused);
      this.state = this.controls.mode === "arrival" ? "typing" : "listening";
      this.draining = false;
      this.lastIdle = Date.now();
      if (
        this.controls.mode === "qa" &&
        this.enabled &&
        (this.voice.status === "disconnected" || this.reconnectAfterGreeting)
      ) {
        this.reconnectAfterGreeting = false;
        void this.voice.connect();
      }
    }
  }
  stop() {
    this.source?.close();
    clearInterval(this.timer);
    this.audio.stop();
    this.voice.disconnect();
  }
}
