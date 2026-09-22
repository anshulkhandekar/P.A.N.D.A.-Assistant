// Realtime transcripts arrive ahead of audio. Pace small, readable phrases from
// playback start instead of treating network delivery as subtitle timing.
export class CaptionPacer {
  private source = "";
  private complete = false;
  private started = false;
  private stopped = false;
  private consumed = 0;
  private nextAt = 0;
  private hideAt = Infinity;
  private current = "";
  private block: { id: number; text: string }[] = [];
  private blockWords = 0;

  reset() {
    this.source = this.current = "";
    this.block = [];
    this.blockWords = 0;
    this.complete = this.started = this.stopped = false;
    this.consumed = this.nextAt = 0;
    this.hideAt = Infinity;
  }
  update(text: string, complete = false) {
    this.source = text;
    this.complete = complete;
  }
  start() {
    this.started = true;
    this.stopped = false;
    this.hideAt = Infinity;
  }
  finish() {
    this.stopped = true;
    this.complete = true;
    this.hideAt = Date.now() + 6500;
  }
  private tick() {
    if (!this.started) return;
    const now = Date.now();
    if (now < this.nextAt) return;
    // Hold incomplete words until another delta arrives.
    const available = this.complete
      ? this.source
      : this.source.replace(/\S+$/, "");
    const words = available.trim().split(/\s+/).filter(Boolean);
    const remaining = words.slice(this.consumed);
    if (!remaining.length) return;
    let count = Math.min(7, remaining.length);
    const punctuation = remaining
      .slice(0, count)
      .findIndex((word, i) => i >= 2 && /[.!?,;:]$/.test(word));
    if (punctuation >= 0) count = punctuation + 1;
    if (!this.complete && count < 4 && punctuation < 0) return;
    // Prefer a sentence boundary after 21 words; keep any block within 35.
    if (
      (this.blockWords >= 21 && /[.!?]["’”)]?$/.test(this.current)) ||
      this.blockWords + count > 35
    ) {
      this.block = [];
      this.blockWords = 0;
    }
    this.current = remaining.slice(0, count).join(" ");
    this.block.push({ id: this.consumed, text: this.current });
    this.blockWords += count;
    this.consumed += count;
    const duration = Math.max(
      1700,
      (count / 2.6) * 1000 + (/[.!?]$/.test(this.current) ? 300 : 0),
    );
    this.nextAt = now + duration;
    // Drain queued phrases at a readable rate even if playback ended first.
    if (this.stopped) this.hideAt = this.nextAt + 5000;
  }
  get lines() {
    this.tick();
    return this.block;
  }
  get text() {
    this.tick();
    return this.current;
  }
  get visible() {
    this.tick();
    return this.started && !!this.current && Date.now() < this.hideAt;
  }
}
