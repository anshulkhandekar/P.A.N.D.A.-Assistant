import { env, log } from "../config/env.js";
import type { Arrival } from "../../../shared/domain.js";
import type { GoogleSheetsService } from "./GoogleSheetsService.js";

export class SheetPoller {
  seen = new Set<string>();
  lastSync: string | null = null;
  lastError: string | null = null;
  rowCount = 0;
  private failures = 0;
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private initialized = false;
  private stopped = true;
  constructor(
    private sheets: Pick<GoogleSheetsService, "snapshot">,
    private onArrival: (a: Arrival) => void,
  ) {}
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    const tick = async () => {
      await this.refresh();
      if (!this.stopped)
        this.timer = setTimeout(
          tick,
          Math.min(60000, env.SHEETS_POLL_INTERVAL_MS * 2 ** this.failures),
        );
    };
    void tick();
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
  }
  refresh() {
    if (this.running) return this.running;
    this.running = this.sync().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }
  private async sync() {
    try {
      const events = await this.sheets.snapshot();
      this.rowCount = events.length;
      for (const arrival of events) {
        if (this.seen.has(arrival.eventId)) continue;
        this.seen.add(arrival.eventId);
        if (this.initialized) this.onArrival(arrival);
      }
      // First successful read establishes a baseline: never greet old responses
      // just because the app restarted or was pointed at an existing sheet.
      this.initialized = true;
      this.lastSync = new Date().toISOString();
      this.lastError = null;
      this.failures = 0;
    } catch (error) {
      this.failures = Math.min(this.failures + 1, 5);
      this.lastError =
        error instanceof Error ? error.message : "Sheets sync failed";
      log("SHEETS_SYNC_ERROR", { retry: this.failures });
    }
  }
}
