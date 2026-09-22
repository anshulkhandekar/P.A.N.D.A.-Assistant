export class AudioEngine {
  context?: AudioContext;
  analyser?: AnalyserNode;
  private source?: MediaElementAudioSourceNode;
  private streamSource?: MediaStreamAudioSourceNode;
  private greeting = new Audio();
  readonly remote = new Audio();
  volume = 0;
  private frame = 0;
  private remoteAnalyser?: AnalyserNode;
  private cancelPlayback?: () => void;
  private inputSource?: MediaStreamAudioSourceNode;
  private inputAnalyser?: AnalyserNode;
  private inputPeak = 0;
  private muted = false;
  attachInput(stream: MediaStream) {
    this.stopInput();
    if (!this.context) return;
    this.inputSource = this.context.createMediaStreamSource(stream);
    this.inputAnalyser = this.context.createAnalyser();
    this.inputAnalyser.fftSize = 256;
    this.inputSource.connect(this.inputAnalyser);
  }
  stopInput() {
    this.inputSource?.disconnect();
    this.inputSource = undefined;
    this.inputAnalyser = undefined;
    this.inputPeak = 0;
  }
  takeInputPeak() {
    const peak = this.inputPeak;
    this.inputPeak = 0;
    return peak;
  }
  async unlock() {
    this.context ||= new AudioContext();
    await this.context.resume();
    this.analyser ||= this.context.createAnalyser();
    this.analyser.fftSize = 256;
    if (!this.source) {
      this.source = this.context.createMediaElementSource(this.greeting);
      this.source.connect(this.analyser);
      this.analyser.connect(this.context.destination);
    }
    this.remote.autoplay = true;
    this.sample();
  }
  private sample() {
    cancelAnimationFrame(this.frame);
    const tick = () => {
      if (this.inputAnalyser) {
        const input = new Uint8Array(this.inputAnalyser.fftSize);
        this.inputAnalyser.getByteTimeDomainData(input);
        const rms =
          Math.sqrt(
            input.reduce((sum, v) => sum + (v - 128) ** 2, 0) / input.length,
          ) / 128;
        this.inputPeak = Math.max(this.inputPeak, Math.min(1, rms * 5));
      }
      if (this.analyser) {
        const values = new Uint8Array(this.analyser.fftSize);
        this.analyser.getByteTimeDomainData(values);
        const local =
          Math.sqrt(
            values.reduce((sum, v) => sum + (v - 128) ** 2, 0) / values.length,
          ) / 35;
        let remote = 0;
        if (this.remoteAnalyser) {
          this.remoteAnalyser.getByteTimeDomainData(values);
          remote =
            Math.sqrt(
              values.reduce((sum, v) => sum + (v - 128) ** 2, 0) /
                values.length,
            ) / 35;
        }
        this.volume = this.muted ? 0 : Math.min(1, Math.max(local, remote));
      }
      this.frame = requestAnimationFrame(tick);
    };
    tick();
  }
  setMuted(value: boolean) {
    this.muted = value;
    if (value) this.volume = 0;
    this.greeting.muted = value;
    this.remote.muted = value;
  }
  attach(stream: MediaStream) {
    this.remote.srcObject = stream;
    void this.remote.play().catch(() => {});
    if (this.context && this.analyser) {
      this.streamSource?.disconnect();
      this.streamSource = this.context.createMediaStreamSource(stream);
      const meter = this.context.createAnalyser();
      meter.fftSize = 256;
      this.streamSource.connect(meter);
      this.remoteAnalyser = meter;
    }
  }
  play(blob: Blob) {
    this.stop();
    return new Promise<void>((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const finish = (error?: Error) => {
        clearTimeout(timer);
        this.greeting.pause();
        this.greeting.onended = null;
        this.greeting.onerror = null;
        URL.revokeObjectURL(url);
        this.cancelPlayback = undefined;
        error ? reject(error) : resolve();
      };
      const timer = setTimeout(
        () => finish(Error("Greeting playback timed out")),
        15000,
      );
      this.cancelPlayback = () => finish();
      this.greeting.onended = () => finish();
      this.greeting.onerror = () => finish(Error("Audio playback failed"));
      this.greeting.src = url;
      void this.greeting.play().catch((error) => finish(error));
    });
  }
  stop() {
    this.cancelPlayback?.();
    this.greeting.pause();
  }
  stopRemote() {
    this.remote.pause();
    this.remote.srcObject = null;
    this.streamSource?.disconnect();
    this.remoteAnalyser = undefined;
  }
}
